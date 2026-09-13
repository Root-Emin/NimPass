package nimiq

import (
	"bytes"
	"context"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

var ErrRPCUnavailable = errors.New("nimiq RPC unavailable")
var ErrRPCNotFound = errors.New("nimiq transaction not found")
var ErrRPCMalformed = errors.New("malformed Nimiq RPC response")

// RPCClient uses the PoS JSON-RPC result.data envelope. The URL is supplied
// solely by server configuration; no user-controlled URL reaches this adapter.
type RPCClient struct {
	URL  string
	HTTP *http.Client
}

func NewRPCClient(endpoint string) *RPCClient {
	return &RPCClient{URL: endpoint, HTTP: &http.Client{Timeout: 5 * time.Second}}
}

func (c *RPCClient) call(ctx context.Context, method string, params []any, dst any) error {
	body, err := json.Marshal(map[string]any{"jsonrpc": "2.0", "id": 1, "method": method, "params": params})
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.URL, bytes.NewReader(body))
	if err != nil {
		return ErrRPCUnavailable
	}
	req.Header.Set("Content-Type", "application/json")
	response, err := c.HTTP.Do(req)
	if err != nil {
		return ErrRPCUnavailable
	}
	defer func() { _ = response.Body.Close() }()
	if response.StatusCode != http.StatusOK {
		return ErrRPCUnavailable
	}
	limited := io.LimitReader(response.Body, 2<<20+1)
	data, err := io.ReadAll(limited)
	if err != nil || len(data) > 2<<20 {
		return ErrRPCMalformed
	}
	var envelope struct {
		JSONRPC string `json:"jsonrpc"`
		ID      int    `json:"id"`
		Result  *struct {
			Data json.RawMessage `json:"data"`
		} `json:"result"`
		Error *struct {
			Code    int    `json:"code"`
			Message string `json:"message"`
		} `json:"error"`
	}
	if json.Unmarshal(data, &envelope) != nil || envelope.JSONRPC != "2.0" || envelope.ID != 1 {
		return ErrRPCMalformed
	}
	if envelope.Error != nil {
		// A missing transaction is not a failed payment. All other RPC errors
		// are infrastructure-uncertain and must not trigger a second payment.
		if (method == "getTransactionByHash" || method == "getTransactionFromMempool") && strings.Contains(strings.ToLower(envelope.Error.Message), "not found") {
			return ErrRPCNotFound
		}
		return ErrRPCUnavailable
	}
	if envelope.Result == nil || len(envelope.Result.Data) == 0 || string(envelope.Result.Data) == "null" {
		return ErrRPCMalformed
	}
	if json.Unmarshal(envelope.Result.Data, dst) != nil {
		return ErrRPCMalformed
	}
	return nil
}

func (c *RPCClient) NetworkID(ctx context.Context) (string, error) {
	var value string
	err := c.call(ctx, "getNetworkId", []any{}, &value)
	return value, err
}

func ExpectedNetworkID(network string) (string, uint8, error) {
	switch network {
	case "TESTNET":
		return "TestAlbatross", 5, nil
	case "MAINNET":
		return "MainAlbatross", 24, nil
	default:
		return "", 0, fmt.Errorf("unsupported network")
	}
}

func (c *RPCClient) CheckNetwork(ctx context.Context, network string) error {
	expected, _, err := ExpectedNetworkID(network)
	if err != nil {
		return err
	}
	actual, err := c.NetworkID(ctx)
	if err != nil {
		return err
	}
	if actual != expected {
		return fmt.Errorf("nimiq RPC network mismatch: expected %s, got %s", expected, actual)
	}
	return nil
}

type ChainTransaction struct {
	Hash            string  `json:"hash"`
	BlockNumber     *uint32 `json:"blockNumber"`
	Timestamp       *uint64 `json:"timestamp"`
	From            string  `json:"from"`
	FromType        *uint8  `json:"fromType"`
	To              string  `json:"to"`
	ToType          *uint8  `json:"toType"`
	Value           *uint64 `json:"value"`
	SenderData      string  `json:"senderData"`
	RecipientData   string  `json:"recipientData"`
	Flags           *uint8  `json:"flags"`
	Proof           string  `json:"proof"`
	NetworkID       *uint8  `json:"networkId"`
	ExecutionResult *bool   `json:"executionResult"`
}

type ChainBlock struct {
	Hash         string             `json:"hash"`
	Number       uint32             `json:"number"`
	Timestamp    uint64             `json:"timestamp"`
	Network      string             `json:"network"`
	Type         string             `json:"type"`
	Transactions []ChainTransaction `json:"transactions"`
}

type ChainEvidence struct {
	Transaction    ChainTransaction
	IncludedAt     time.Time
	InclusionBlock uint32
	FinalityBlock  uint32
	FinalizedAt    time.Time
	Finalized      bool
}

func (c *RPCClient) Inspect(ctx context.Context, hash, network string) (ChainEvidence, error) {
	ctx, cancel := context.WithTimeout(ctx, 8*time.Second)
	defer cancel()
	expectedName, expectedID, err := ExpectedNetworkID(network)
	if err != nil {
		return ChainEvidence{}, err
	}
	if err := c.CheckNetwork(ctx, network); err != nil {
		return ChainEvidence{}, err
	}
	var consensus bool
	if err := c.call(ctx, "isConsensusEstablished", []any{}, &consensus); err != nil {
		return ChainEvidence{}, err
	}
	if !consensus {
		return ChainEvidence{}, ErrRPCUnavailable
	}
	var tx ChainTransaction
	if err := c.call(ctx, "getTransactionByHash", []any{hash}, &tx); err != nil {
		if !errors.Is(err, ErrRPCNotFound) {
			return ChainEvidence{}, err
		}
		if err = c.call(ctx, "getTransactionFromMempool", []any{hash}, &tx); err != nil {
			return ChainEvidence{}, err
		}
	}
	if !strings.EqualFold(tx.Hash, hash) || tx.NetworkID == nil || *tx.NetworkID != expectedID || tx.Value == nil || tx.FromType == nil || tx.ToType == nil || tx.Flags == nil || (tx.BlockNumber != nil && tx.ExecutionResult == nil) {
		return ChainEvidence{}, ErrRPCMalformed
	}
	if tx.BlockNumber == nil {
		return ChainEvidence{Transaction: tx}, nil
	}
	var included ChainBlock
	if err := c.call(ctx, "getBlockByNumber", []any{*tx.BlockNumber, true}, &included); err != nil {
		return ChainEvidence{}, err
	}
	if included.Number != *tx.BlockNumber || included.Network != expectedName || included.Type != "micro" || included.Hash == "" || included.Timestamp == 0 || included.Transactions == nil {
		return ChainEvidence{}, ErrRPCMalformed
	}
	matched := false
	for _, inBlock := range included.Transactions {
		if strings.EqualFold(inBlock.Hash, hash) && inBlock.ExecutionResult != nil && *inBlock.ExecutionResult == *tx.ExecutionResult {
			matched = true
			break
		}
	}
	if !matched {
		return ChainEvidence{}, ErrRPCUnavailable
	} // possible reorg or unsynced node
	evidence := ChainEvidence{Transaction: tx, InclusionBlock: included.Number, IncludedAt: time.UnixMilli(int64(included.Timestamp)).UTC()}
	if tx.Timestamp == nil || *tx.Timestamp != included.Timestamp {
		return ChainEvidence{}, ErrRPCMalformed
	}
	var macroHeight uint32
	if err := c.call(ctx, "getMacroBlockAfter", []any{included.Number}, &macroHeight); err != nil {
		return ChainEvidence{}, err
	}
	if macroHeight <= included.Number {
		return ChainEvidence{}, ErrRPCMalformed
	}
	var head ChainBlock
	if err := c.call(ctx, "getLatestBlock", []any{false}, &head); err != nil {
		return ChainEvidence{}, err
	}
	if head.Network != expectedName || head.Hash == "" {
		return ChainEvidence{}, ErrRPCMalformed
	}
	if head.Number < macroHeight {
		return evidence, nil
	}
	var macro ChainBlock
	if err := c.call(ctx, "getBlockByNumber", []any{macroHeight, false}, &macro); err != nil {
		return ChainEvidence{}, err
	}
	if macro.Number != macroHeight || macro.Network != expectedName || macro.Type != "macro" || macro.Hash == "" || macro.Timestamp < included.Timestamp {
		return ChainEvidence{}, ErrRPCMalformed
	}
	// Re-read the inclusion height after observing the macro block. The first
	// lookup could have raced a reorg; finality must apply to the same chain.
	var canonical ChainBlock
	if err := c.call(ctx, "getBlockByNumber", []any{included.Number, false}, &canonical); err != nil {
		return ChainEvidence{}, err
	}
	if canonical.Hash != included.Hash || canonical.Number != included.Number || canonical.Network != expectedName {
		return ChainEvidence{}, ErrRPCUnavailable
	}
	evidence.FinalityBlock = macroHeight
	evidence.FinalizedAt = time.UnixMilli(int64(macro.Timestamp)).UTC()
	evidence.Finalized = true
	return evidence, nil
}

func DecodeRecipientData(value string) ([]byte, error) {
	value = strings.TrimPrefix(value, "0x")
	if len(value)%2 != 0 {
		return nil, ErrRPCMalformed
	}
	data, err := hex.DecodeString(value)
	if err != nil {
		return nil, ErrRPCMalformed
	}
	return data, nil
}

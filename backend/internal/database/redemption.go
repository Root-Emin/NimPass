package database

import (
	"context"
	"crypto/sha256"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"nimpass/backend/internal/application"
	"nimpass/backend/internal/domain"
)

const redemptionFields = `c.id,c.pass_id,c.provider_id,c.owner_wallet,c.nonce,c.status,c.purpose,c.network,c.environment,c.expected_used_sessions,c.expected_remaining_sessions,c.created_at,c.expires_at,c.authorized_at,c.consumed_at,c.qr_expires_at,pa.id,pa.purchase_id,pa.owner_wallet,pa.package_id,pa.provider_id,pa.service_id,pa.package_title_snapshot,pa.service_name_snapshot,pa.provider_name_snapshot,pa.price_luna_snapshot,pa.original_sessions,pa.used_sessions,pa.remaining_sessions,pa.status,pa.created_at,pa.expires_at,pa.completed_at,r.id,r.session_ordinal,r.consumed_at`
const redemptionJoins = ` FROM redemption_challenges c JOIN passes pa ON pa.id=c.pass_id LEFT JOIN redemptions r ON r.challenge_id=c.id `

func scanRedemptionView(r row) (application.RedemptionView, error) {
	var view application.RedemptionView
	var challenge, passID, providerID, owner, nonce, status, purpose, network, environment string
	var passOwner, purchaseID, packageID, passProviderID, serviceID, packageTitle, serviceName, providerName, passStatus string
	var qrExpires *time.Time
	var authorizedAt, consumedAt *time.Time
	var passExpires, passCompleted *time.Time
	var redemptionID, redemptionOrdinal *string
	var redemptionConsumed *time.Time
	err := r.Scan(&challenge, &passID, &providerID, &owner, &nonce, &status, &purpose, &network, &environment, &view.Challenge.ExpectedUsedSessions, &view.Challenge.ExpectedRemainingSessions, &view.Challenge.CreatedAt, &view.Challenge.ExpiresAt, &authorizedAt, &consumedAt, &qrExpires, &view.Pass.ID, &purchaseID, &passOwner, &packageID, &passProviderID, &serviceID, &packageTitle, &serviceName, &providerName, &view.Pass.Snapshot.PriceLuna, &view.Pass.OriginalSessions, &view.Pass.UsedSessions, &view.Pass.RemainingSessions, &passStatus, &view.Pass.CreatedAt, &passExpires, &passCompleted, &redemptionID, &redemptionOrdinal, &redemptionConsumed)
	if err != nil {
		return view, notFound(err)
	}
	view.Challenge.ID = domain.ID(challenge)
	view.Challenge.PassID = domain.ID(passID)
	view.Challenge.ProviderID = domain.ID(providerID)
	view.Challenge.OwnerWallet = domain.WalletAddress(owner)
	view.Challenge.Nonce = domain.ID(nonce)
	view.Challenge.Status = domain.RedemptionStatus(status)
	view.Challenge.Purpose = purpose
	view.Challenge.Network = domain.NimiqNetwork(network)
	view.Challenge.Environment = environment
	view.Challenge.AuthorizedAt = authorizedAt
	view.Challenge.ConsumedAt = consumedAt
	view.QRExpiresAt = qrExpires
	view.Pass.PurchaseID = domain.ID(purchaseID)
	view.Pass.OwnerWallet = domain.WalletAddress(passOwner)
	view.Pass.Snapshot.PackageID = domain.ID(packageID)
	view.Pass.Snapshot.ProviderID = domain.ID(passProviderID)
	view.Pass.Snapshot.ServiceID = domain.ID(serviceID)
	view.Pass.Snapshot.PackageTitle = packageTitle
	view.Pass.Snapshot.ServiceName = serviceName
	view.Pass.Snapshot.ProviderName = providerName
	view.Pass.Snapshot.Expiration = domain.NewExpirationPolicy(passExpires)
	view.Pass.Status = domain.PassStatus(passStatus)
	view.Pass.ExpiresAt = passExpires
	view.Pass.CompletedAt = passCompleted
	if redemptionID != nil {
		view.HasRedemption = true
		view.Redemption.ID = domain.ID(*redemptionID)
		view.Redemption.ChallengeID = view.Challenge.ID
		view.Redemption.PassID = view.Pass.ID
		view.Redemption.ProviderID = view.Challenge.ProviderID
		view.Redemption.OwnerWallet = view.Challenge.OwnerWallet
		if redemptionOrdinal != nil {
			view.Redemption.SessionOrdinal = domain.SessionCount(parseInt32(*redemptionOrdinal))
		}
		view.Redemption.ConsumedAt = redemptionConsumed.UTC()
	}
	return view, nil
}

func parseInt32(value string) int32 {
	var result int32
	for _, c := range value {
		if c >= '0' && c <= '9' {
			result = result*10 + int32(c-'0')
		}
	}
	return result
}

func (r PaymentRepository) CurrentChallenge(ctx context.Context, passID, customerID domain.ID, wallet domain.WalletAddress, now time.Time) (application.RedemptionView, error) {
	_, err := r.Pool.Exec(ctx, `UPDATE redemption_challenges c SET status='EXPIRED' WHERE c.pass_id=$1 AND c.status IN ('CREATED','AUTHORIZED') AND c.expires_at<=$2`, passID, now)
	if err != nil {
		return application.RedemptionView{}, err
	}
	return scanRedemptionView(r.Pool.QueryRow(ctx, `SELECT `+redemptionFields+redemptionJoins+` JOIN purchases pu ON pu.id=pa.purchase_id WHERE c.pass_id=$1 AND pu.customer_context_id=$2 AND c.owner_wallet=$3 AND c.status IN ('CREATED','AUTHORIZED') ORDER BY c.created_at DESC LIMIT 1`, passID, customerID, wallet))
}

func (r PaymentRepository) GetChallenge(ctx context.Context, id, customerID domain.ID, wallet domain.WalletAddress) (application.RedemptionView, error) {
	return scanRedemptionView(r.Pool.QueryRow(ctx, `SELECT `+redemptionFields+redemptionJoins+` JOIN purchases pu ON pu.id=pa.purchase_id WHERE c.id=$1 AND pu.customer_context_id=$2 AND c.owner_wallet=$3`, id, customerID, wallet))
}

func (r PaymentRepository) LookupRedemption(ctx context.Context, providerID, actorID domain.ID, rawToken string) (application.RedemptionView, error) {
	digest := sha256.Sum256([]byte(rawToken))
	return scanRedemptionView(r.Pool.QueryRow(ctx, `SELECT `+redemptionFields+redemptionJoins+` JOIN providers pr ON pr.id=c.provider_id WHERE c.qr_token_digest=$1 AND pr.id=$2 AND pr.owner_identity_id=$3 FOR SHARE OF c,pa`, digest[:], providerID, actorID))
}

func (r PaymentRepository) InsertChallenge(ctx context.Context, challenge domain.RedemptionChallenge, customerID domain.ID, wallet domain.WalletAddress, now time.Time) (application.RedemptionView, error) {
	tx, err := r.Pool.Begin(ctx)
	if err != nil {
		return application.RedemptionView{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	tag, err := tx.Exec(ctx, `INSERT INTO redemption_challenges(id,pass_id,provider_id,owner_wallet,nonce,status,created_at,expires_at,purpose,network,environment,expected_used_sessions,expected_remaining_sessions) SELECT $1::uuid,pa.id,pa.provider_id,$3::varchar,$12::uuid,'CREATED',$4::timestamptz,$5::timestamptz,$6::varchar,$7::varchar,$8::varchar,$9::integer,$10::integer FROM passes pa JOIN purchases pu ON pu.id=pa.purchase_id WHERE pa.id=$2::uuid AND pu.customer_context_id=$11::uuid AND pa.owner_wallet=$3::varchar AND pa.status='ACTIVE' AND pa.used_sessions=$9::integer AND pa.remaining_sessions=$10::integer AND (pa.expires_at IS NULL OR pa.expires_at>$5::timestamptz)`, challenge.ID, challenge.PassID, wallet, challenge.CreatedAt, challenge.ExpiresAt, challenge.Purpose, challenge.Network, challenge.Environment, challenge.ExpectedUsedSessions, challenge.ExpectedRemainingSessions, customerID, challenge.Nonce)
	if err != nil {
		if isUniqueViolation(err) {
			return application.RedemptionView{}, application.ErrConflict
		}
		return application.RedemptionView{}, err
	}
	if tag.RowsAffected() != 1 {
		return application.RedemptionView{}, application.ErrConflict
	}
	if _, err = tx.Exec(ctx, `INSERT INTO redemption_events(id,challenge_id,pass_id,provider_id,kind,occurred_at) VALUES($1,$2,$3,$4,'CHALLENGE_CREATED',$5)`, mustNewID(), challenge.ID, challenge.PassID, challenge.ProviderID, now); err != nil {
		return application.RedemptionView{}, err
	}
	view, err := scanRedemptionView(tx.QueryRow(ctx, `SELECT `+redemptionFields+redemptionJoins+` WHERE c.id=$1`, challenge.ID))
	if err != nil {
		return application.RedemptionView{}, err
	}
	if err = tx.Commit(ctx); err != nil {
		return application.RedemptionView{}, err
	}
	return view, nil
}

func (r PaymentRepository) AuthorizeChallenge(ctx context.Context, id, customerID domain.ID, wallet domain.WalletAddress, publicKey, signature, rawToken string, publicDigest, signatureDigest, tokenDigest [32]byte, now time.Time) (application.RedemptionView, error) {
	tx, err := r.Pool.Begin(ctx)
	if err != nil {
		return application.RedemptionView{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	var passID, providerID domain.ID
	err = tx.QueryRow(ctx, `SELECT c.pass_id,c.provider_id FROM redemption_challenges c JOIN passes pa ON pa.id=c.pass_id JOIN purchases pu ON pu.id=pa.purchase_id WHERE c.id=$1 AND pu.customer_context_id=$2 AND c.owner_wallet=$3 AND c.status='CREATED' AND c.expires_at>$4 AND pa.status='ACTIVE' AND pa.remaining_sessions=c.expected_remaining_sessions AND pa.used_sessions=c.expected_used_sessions AND (pa.expires_at IS NULL OR pa.expires_at>$4) FOR UPDATE OF c,pa`, id, customerID, wallet, now).Scan(&passID, &providerID)
	if errors.Is(err, pgx.ErrNoRows) {
		return application.RedemptionView{}, application.ErrConflict
	}
	if err != nil {
		return application.RedemptionView{}, err
	}
	_, err = tx.Exec(ctx, `UPDATE redemption_challenges SET status='AUTHORIZED',authorized_at=$2,qr_token_digest=$3,qr_issued_at=$2,qr_expires_at=LEAST(expires_at,$2::timestamptz+interval '5 minutes'),authorized_public_key_digest=$4,authorized_signature_digest=$5 WHERE id=$1`, id, now, tokenDigest[:], publicDigest[:], signatureDigest[:])
	if err != nil {
		return application.RedemptionView{}, err
	}
	if _, err = tx.Exec(ctx, `INSERT INTO redemption_events(id,challenge_id,pass_id,provider_id,kind,occurred_at) VALUES($1,$2,$3,$4,'CHALLENGE_AUTHORIZED',$5)`, mustNewID(), id, passID, providerID, now); err != nil {
		return application.RedemptionView{}, err
	}
	view, err := scanRedemptionView(tx.QueryRow(ctx, `SELECT `+redemptionFields+redemptionJoins+` WHERE c.id=$1`, id))
	if err != nil {
		return application.RedemptionView{}, err
	}
	if err = tx.Commit(ctx); err != nil {
		return application.RedemptionView{}, err
	}
	view.QRReference = "NR1:" + rawToken
	return view, nil
}

func (r PaymentRepository) RotateToken(ctx context.Context, id, customerID domain.ID, wallet domain.WalletAddress, tokenDigest [32]byte, rawToken string, now time.Time) (application.RedemptionView, error) {
	tx, err := r.Pool.Begin(ctx)
	if err != nil {
		return application.RedemptionView{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	result, err := tx.Exec(ctx, `UPDATE redemption_challenges c SET qr_token_digest=$4,qr_issued_at=$5,qr_expires_at=LEAST(c.expires_at,$5::timestamptz+interval '5 minutes') FROM passes pa JOIN purchases pu ON pu.id=pa.purchase_id WHERE c.id=$1 AND pa.id=c.pass_id AND pu.customer_context_id=$2 AND c.owner_wallet=$3 AND c.status='AUTHORIZED' AND c.expires_at>$5 AND pa.status='ACTIVE' AND pa.used_sessions=c.expected_used_sessions AND pa.remaining_sessions=c.expected_remaining_sessions AND (pa.expires_at IS NULL OR pa.expires_at>$5)`, id, customerID, wallet, tokenDigest[:], now)
	if err != nil {
		return application.RedemptionView{}, err
	}
	if result.RowsAffected() != 1 {
		return application.RedemptionView{}, application.ErrConflict
	}
	view, err := scanRedemptionView(tx.QueryRow(ctx, `SELECT `+redemptionFields+redemptionJoins+` WHERE c.id=$1`, id))
	if err != nil {
		return application.RedemptionView{}, err
	}
	if err = tx.Commit(ctx); err != nil {
		return application.RedemptionView{}, err
	}
	view.QRReference = "NR1:" + rawToken
	return view, nil
}

func (r PaymentRepository) ConfirmRedemption(ctx context.Context, providerID, actorID domain.ID, rawToken string, now time.Time) (application.RedemptionView, error) {
	digest := sha256.Sum256([]byte(rawToken))
	tx, err := r.Pool.Begin(ctx)
	if err != nil {
		return application.RedemptionView{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	view, err := scanRedemptionView(tx.QueryRow(ctx, `SELECT `+redemptionFields+redemptionJoins+` JOIN providers pr ON pr.id=c.provider_id WHERE c.qr_token_digest=$1 AND pr.id=$2 AND pr.owner_identity_id=$3 FOR UPDATE OF c,pa`, digest[:], providerID, actorID))
	if err != nil {
		if errors.Is(err, application.ErrNotFound) {
			return application.RedemptionView{}, application.ErrInvalidRedemptionToken
		}
		return application.RedemptionView{}, err
	}
	if view.Challenge.Status == domain.RedemptionConsumed || view.HasRedemption {
		return view, application.ErrRedemptionConsumed
	}
	if view.Challenge.Status != domain.RedemptionAuthorized {
		return view, application.ErrRedemptionNotAuthorized
	}
	if !now.Before(view.Challenge.ExpiresAt) || view.QRExpiresAt != nil && !now.Before(*view.QRExpiresAt) {
		_, _ = tx.Exec(ctx, `UPDATE redemption_challenges SET status='EXPIRED' WHERE id=$1 AND status='AUTHORIZED'`, view.Challenge.ID)
		return view, application.ErrRedemptionChallengeExpired
	}
	if view.Pass.Status == domain.PassCompleted || view.Pass.RemainingSessions == 0 {
		return view, application.ErrPassCompleted
	}
	if view.Pass.Status != domain.PassActive {
		return view, application.ErrPassExpired
	}
	if view.Pass.ExpiresAt != nil && !now.Before(*view.Pass.ExpiresAt) {
		return view, application.ErrPassExpired
	}
	if int32(view.Pass.UsedSessions) != view.Challenge.ExpectedUsedSessions || int32(view.Pass.RemainingSessions) != view.Challenge.ExpectedRemainingSessions {
		return view, application.ErrStaleRedemptionChallenge
	}
	if err := view.Challenge.Consume(&view.Pass, now); err != nil {
		return view, application.ErrConflict
	}
	redemptionID, err := domain.NewID()
	if err != nil {
		return view, err
	}
	redemption, err := domain.NewRedemption(redemptionID, view.Challenge, view.Pass)
	if err != nil {
		return view, application.ErrConflict
	}
	if _, err = tx.Exec(ctx, `UPDATE redemption_challenges SET status='CONSUMED',consumed_at=$2 WHERE id=$1 AND status='AUTHORIZED'`, view.Challenge.ID, now); err != nil {
		return view, err
	}
	completedAt := view.Pass.CompletedAt
	if view.Pass.Status == domain.PassCompleted && completedAt == nil {
		completedAt = &now
	}
	if _, err = tx.Exec(ctx, `UPDATE passes SET used_sessions=$2,remaining_sessions=$3,status=$4,completed_at=$5 WHERE id=$1`, view.Pass.ID, view.Pass.UsedSessions, view.Pass.RemainingSessions, view.Pass.Status, completedAt); err != nil {
		return view, err
	}
	if _, err = tx.Exec(ctx, `INSERT INTO redemptions(id,challenge_id,pass_id,provider_id,owner_wallet,session_ordinal,sessions_consumed,consumed_at) VALUES($1,$2,$3,$4,$5,$6,1,$7)`, redemption.ID, redemption.ChallengeID, redemption.PassID, redemption.ProviderID, redemption.OwnerWallet, redemption.SessionOrdinal, redemption.ConsumedAt); err != nil {
		return view, err
	}
	if _, err = tx.Exec(ctx, `INSERT INTO redemption_events(id,challenge_id,redemption_id,pass_id,provider_id,kind,occurred_at) VALUES($1,$2,$3,$4,$5,'REDEMPTION_CONSUMED',$6)`, mustNewID(), redemption.ChallengeID, redemption.ID, redemption.PassID, redemption.ProviderID, now); err != nil {
		return view, err
	}
	if view.Pass.Status == domain.PassCompleted {
		if _, err = tx.Exec(ctx, `INSERT INTO redemption_events(id,challenge_id,redemption_id,pass_id,provider_id,kind,occurred_at) VALUES($1,$2,$3,$4,$5,'PASS_COMPLETED',$6)`, mustNewID(), redemption.ChallengeID, redemption.ID, redemption.PassID, redemption.ProviderID, now); err != nil {
			return view, err
		}
	}
	if err = tx.Commit(ctx); err != nil {
		return view, err
	}
	view.Redemption = redemption
	view.HasRedemption = true
	view.QRReference = ""
	return view, nil
}

func (r PaymentRepository) ListPassHistory(ctx context.Context, passID, customerID domain.ID, wallet domain.WalletAddress) ([]application.RedemptionHistoryItem, error) {
	rows, err := r.Pool.Query(ctx, `SELECT r.id,r.challenge_id,r.pass_id,r.provider_id,pa.service_id,pa.package_id,r.owner_wallet,r.session_ordinal,r.consumed_at FROM redemptions r JOIN passes pa ON pa.id=r.pass_id JOIN purchases pu ON pu.id=pa.purchase_id WHERE r.pass_id=$1 AND pu.customer_context_id=$2 AND r.owner_wallet=$3 ORDER BY r.consumed_at DESC LIMIT 100`, passID, customerID, wallet)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanHistory(rows)
}

func (r PaymentRepository) ListProviderHistory(ctx context.Context, providerID, actorID domain.ID) ([]application.RedemptionHistoryItem, error) {
	rows, err := r.Pool.Query(ctx, `SELECT r.id,r.challenge_id,r.pass_id,r.provider_id,pa.service_id,pa.package_id,r.owner_wallet,r.session_ordinal,r.consumed_at FROM redemptions r JOIN passes pa ON pa.id=r.pass_id JOIN providers pr ON pr.id=r.provider_id WHERE r.provider_id=$1 AND pr.owner_identity_id=$2 ORDER BY r.consumed_at DESC LIMIT 100`, providerID, actorID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanHistory(rows)
}

func scanHistory(rows pgx.Rows) ([]application.RedemptionHistoryItem, error) {
	out := make([]application.RedemptionHistoryItem, 0)
	for rows.Next() {
		var item application.RedemptionHistoryItem
		var redemptionID, challengeID, passID, providerID, serviceID, packageID string
		var ordinal int32
		if err := rows.Scan(&redemptionID, &challengeID, &passID, &providerID, &serviceID, &packageID, &item.OwnerWallet, &ordinal, &item.ConsumedAt); err != nil {
			return nil, err
		}
		item.RedemptionID = domain.ID(redemptionID)
		item.ChallengeID = domain.ID(challengeID)
		item.PassID = domain.ID(passID)
		item.ProviderID = domain.ID(providerID)
		item.ServiceID = domain.ID(serviceID)
		item.PackageID = domain.ID(packageID)
		item.SessionOrdinal = domain.SessionCount(ordinal)
		out = append(out, item)
	}
	return out, rows.Err()
}

func (r PaymentRepository) RecordEvent(ctx context.Context, challengeID domain.ID, kind, category string, now time.Time) error {
	_, err := r.Pool.Exec(ctx, `INSERT INTO redemption_events(id,challenge_id,pass_id,provider_id,kind,category,occurred_at) SELECT $1,c.id,c.pass_id,c.provider_id,$2,$3,$4 FROM redemption_challenges c WHERE c.id=$5`, mustNewID(), kind, nullable(category), now, challengeID)
	return err
}

func mustNewID() domain.ID {
	id, _ := domain.NewID()
	return id
}

func isUniqueViolation(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "23505"
}

package main

import (
	"context"
	"io"
	"log/slog"
	"sync"
	"testing"
	"time"
)

func TestReconcilerStopsBeforeShutdownContinues(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	started := make(chan struct{})
	release := make(chan struct{})
	var startOnce sync.Once
	done := startReconciler(ctx, func(ctx context.Context) error {
		startOnce.Do(func() { close(started) })
		<-ctx.Done()
		<-release
		return ctx.Err()
	}, func(context.Context) bool { return true }, slog.New(slog.NewTextHandler(io.Discard, nil)))
	select {
	case <-started:
	case <-time.After(time.Second):
		t.Fatal("reconciliation worker did not start")
	}
	cancel()
	select {
	case <-done:
		t.Fatal("worker reported completion while reconciliation was still running")
	default:
	}
	close(release)
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("worker did not stop after cancellation")
	}
}

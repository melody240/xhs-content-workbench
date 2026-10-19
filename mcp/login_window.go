package main

import (
	"context"
	"github.com/go-rod/rod"
	"github.com/go-rod/rod/lib/proto"
	"time"
)

// Restore and focus exactly the page that is waiting for this login.
func focusLoginPage(ctx context.Context, page *rod.Page) error {
	pp := page.Context(ctx).Timeout(5 * time.Second)
	if err := pp.SetWindow(&proto.BrowserBounds{WindowState: proto.BrowserWindowStateNormal}); err != nil {
		return err
	}
	if _, err := pp.Activate(); err != nil {
		return err
	}
	return (proto.PageBringToFront{}).Call(pp)
}

package main

import (
	"context"
	"github.com/go-rod/rod"
	"github.com/go-rod/rod/lib/launcher"
	"github.com/go-rod/rod/lib/proto"
	"os"
	"testing"
)

// Only a fresh local browser and an inline test document, no user login data.
func TestLoginWindowRestoreLocalFixture(t *testing.T) {
	bin := os.Getenv("XHS_TEST_BROWSER")
	if bin == "" {
		t.Skip("set XHS_TEST_BROWSER for local window test")
	}
	l := launcher.New().Bin(bin).Headless(false)
	u, err := l.Launch()
	if err != nil {
		t.Fatal(err)
	}
	defer l.Cleanup()
	b := rod.New().ControlURL(u)
	if err := b.Connect(); err != nil {
		t.Fatal(err)
	}
	defer b.Close()
	p, err := b.Page(proto.TargetCreateTarget{URL: "about:blank"})
	if err != nil {
		t.Fatal(err)
	}
	defer p.Close()
	if err := p.SetDocumentContent("<title>工作台登录窗口测试（本地）</title><p>仅测试窗口恢复</p>"); err != nil {
		t.Fatal(err)
	}
	if err := p.SetWindow(&proto.BrowserBounds{WindowState: proto.BrowserWindowStateMinimized}); err != nil {
		t.Fatal(err)
	}
	if err := focusLoginPage(context.Background(), p); err != nil {
		t.Fatal(err)
	}
	bounds, err := p.GetWindow()
	if err != nil {
		t.Fatal(err)
	}
	if bounds.WindowState != proto.BrowserWindowStateNormal {
		t.Fatalf("window not restored: %s", bounds.WindowState)
	}
}

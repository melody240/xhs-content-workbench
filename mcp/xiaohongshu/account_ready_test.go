package xiaohongshu

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
	"time"

	"github.com/go-rod/rod"
	"github.com/go-rod/rod/lib/launcher"
	"github.com/go-rod/rod/lib/proto"
)

// This test uses only a local fixture and a fresh browser with no account data.
func TestAccountReadinessIgnoresUnfinishedResources(t *testing.T) {
	bin := os.Getenv("XHS_TEST_BROWSER")
	if bin == "" {
		t.Skip("set XHS_TEST_BROWSER to run the isolated browser regression")
	}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/pending.png" {
			w.Header().Set("Content-Type", "image/png")
			w.WriteHeader(200)
			w.(http.Flusher).Flush()
			<-r.Context().Done()
			return
		}
		fmt.Fprint(w, `<html><body><div class="main-container"><div class="user"><a class="link-wrapper"><span class="channel">我</span></a></div></div><script>window.__INITIAL_STATE__={user:{userPageData:{value:{}},notes:{value:[[]]}}};setTimeout(()=>window.__INITIAL_STATE__.user.userPageData.value={basicInfo:{nickname:"fixture",redId:"fixture-id"}},600)</script><img src="/pending.png"></body></html>`)
	}))
	defer server.Close()
	l := launcher.New().Bin(bin).Headless(true)
	controlURL, err := l.Launch()
	if err != nil {
		t.Fatal(err)
	}
	defer l.Cleanup()
	b := rod.New().ControlURL(controlURL)
	if err := b.Connect(); err != nil {
		t.Fatal(err)
	}
	defer b.Close()
	page, err := b.Page(proto.TargetCreateTarget{URL: "about:blank"})
	if err != nil {
		t.Fatal(err)
	}
	defer page.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	p := page.Context(ctx)
	if err := p.Navigate(server.URL); err != nil {
		t.Fatal(err)
	}
	if err := waitAccountSurface(p); err != nil {
		t.Fatal(err)
	}
	state, err := p.Eval(`() => document.readyState`)
	if err != nil {
		t.Fatal(err)
	}
	if state.Value.Str() == "complete" {
		t.Fatal("fixture must keep window.load pending")
	}
	start := time.Now()
	if err := p.Wait(rod.Eval(profileDataReady)); err != nil {
		t.Fatal(err)
	}
	if time.Since(start) < 200*time.Millisecond {
		t.Fatal("empty profile was accepted before data arrived")
	}
	result, err := NewUserProfileAction(page).extractUserProfileData(p, TabNotes)
	if err != nil {
		t.Fatal(err)
	}
	if result.UserBasicInfo.Nickname != "fixture" || result.Feeds == nil || len(result.Feeds) != 0 {
		t.Fatalf("invalid completed empty account: %+v", result)
	}
	// The live site can expose plain state objects rather than Vue ref wrappers.
	if _, err := p.Eval(`() => {const u=window.__INITIAL_STATE__.user;u.userPageData=u.userPageData.value;u.notes=u.notes.value;return true}`); err != nil {
		t.Fatal(err)
	}
	plain, err := NewUserProfileAction(page).extractUserProfileData(p, TabNotes)
	if err != nil || plain.UserBasicInfo.Nickname != "fixture" {
		t.Fatalf("plain profile state failed: %v", err)
	}
	// A complete sidebar with delayed account data must not wait forever.
	if !NewLogin(page).WaitForLogin(ctx) {
		t.Fatal("visible personal control should finish the scan while identity loads")
	}

	// Login completion must work even when the site's sidebar layout changes.
	if _, err := p.Eval(`() => {document.querySelector(".main-container").remove();window.__INITIAL_STATE__.user.userInfo={_value:{guest:true,nickname:"guest",userId:"guest"}};return true}`); err != nil {
		t.Fatal(err)
	}
	guest, err := p.Eval(currentUserReady)
	if err != nil || guest.Value.Bool() {
		t.Fatal("guest must not count as logged in")
	}
	if _, err := p.Eval(`() => {window.__INITIAL_STATE__.user.userInfo={_value:{guest:false,nickname:"fixture",userId:"fixture-user"}};return true}`); err != nil {
		t.Fatal(err)
	}
	login := NewLogin(page)
	if !login.WaitForLogin(ctx) {
		t.Fatal("authenticated state should finish without sidebar")
	}
	identity, err := login.CurrentUser(ctx)
	if err != nil || identity.UserID != "fixture-user" {
		t.Fatalf("identity not available: %v", err)
	}

	// Guest homepage readiness is distinct from opening a QR dialog.
	if _, err := p.Eval(`() => {window.__INITIAL_STATE__.user.userInfo={guest:true};document.body.insertAdjacentHTML("beforeend",'<input placeholder="登录探索更多内容">');return true}`); err != nil {
		t.Fatal(err)
	}
	if err := waitAccountSurface(p); err != nil {
		t.Fatalf("guest homepage was mistaken for stalled loading: %v", err)
	}

}

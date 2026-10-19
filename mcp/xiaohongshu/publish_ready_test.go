package xiaohongshu

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/go-rod/rod"
	"github.com/go-rod/rod/lib/launcher"
	"github.com/go-rod/rod/lib/proto"
)

func TestPublishReadinessAndBlockedPages(t *testing.T) {
	bin := os.Getenv("XHS_TEST_BROWSER")
	if bin == "" {
		t.Skip("set XHS_TEST_BROWSER for isolated browser regression")
	}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/pending.png" {
			w.Header().Set("Content-Type", "image/png")
			w.WriteHeader(200)
			w.(http.Flusher).Flush()
			<-r.Context().Done()
			return
		}
		switch r.URL.Path {
		case "/login":
			fmt.Fprint(w, `<body>扫码登录</body>`)
		case "/verify":
			fmt.Fprint(w, `<body><div class="captcha">请完成安全验证</div><div class="upload-content"><div class="creator-tab">上传图文</div></div></body>`)
		default:
			fmt.Fprint(w, `<body><div class="upload-content"><div class="creator-tab">上传图文</div><input type="file"></div><img src="/pending.png"></body>`)
		}
	}))
	defer server.Close()
	l := launcher.New().Bin(bin).Headless(true)
	control, err := l.Launch()
	if err != nil {
		t.Fatal(err)
	}
	defer l.Cleanup()
	b := rod.New().ControlURL(control)
	if err := b.Connect(); err != nil {
		t.Fatal(err)
	}
	defer b.Close()
	page, err := b.Page(proto.TargetCreateTarget{URL: "about:blank"})
	if err != nil {
		t.Fatal(err)
	}
	defer page.Close()
	for _, fixture := range []struct{ route, state, reason string }{{"/", "ready", ""}, {"/login", "login_required", "创作后台"}, {"/verify", "verification_required", "本人完成安全验证"}} {
		p := page.Timeout(5 * time.Second)
		if err := p.Navigate(server.URL + fixture.route); err != nil {
			t.Fatal(err)
		}
		state, err := publishState(p)
		if err != nil || state != fixture.state {
			t.Fatalf("state=%s err=%v", state, err)
		}
		err = requirePublishSurface(p)
		if fixture.reason == "" && err != nil {
			t.Fatal(err)
		}
		if fixture.reason != "" && (err == nil || !strings.Contains(err.Error(), fixture.reason)) {
			t.Fatalf("unexpected blocker: %v", err)
		}
		if fixture.state == "ready" {
			r, err := p.Eval(`() => document.readyState`)
			if err != nil || r.Value.Str() == "complete" {
				t.Fatal("fixture must keep window.load pending")
			}
		}
	}
}

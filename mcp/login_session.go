package main

import (
	"context"
	"fmt"
	"sync"
	"time"

	"github.com/xpzouying/xiaohongshu-mcp/xiaohongshu"
)

type loginProgress struct {
	Sequence        uint64                   `json:"sequence"`
	Status          string                   `json:"status"`
	ExpiresAt       time.Time                `json:"expiresAt,omitempty"`
	Account         *xiaohongshu.CurrentUser `json:"account,omitempty"`
	Message         string                   `json:"message,omitempty"`
	WindowAvailable bool                     `json:"windowAvailable"`
}

// loginSessions 管理「已发出二维码、还在等扫码」的登录会话。
//
// 取一次二维码就要留一个浏览器活着等扫码，否则检测不到登录、也存不了 cookie。
// 但没有任何东西拦着重复调用，于是每调一次就多一个浏览器活到超时为止。
// 这里的约束是：同一时刻只保留一个待扫码会话，开新的就把旧的关掉。
type loginSessions struct {
	mu         sync.Mutex
	seq        uint64
	cancel     func()
	progress   loginProgress
	showWindow func(context.Context) error
}

// start 结束上一个待扫码会话（如果有），登记新的，返回本次会话的序号。
// 序号用于 finish 判断自己是不是仍然是当前会话。
func (l *loginSessions) start(cancel func()) uint64 {
	l.mu.Lock()
	prev := l.cancel
	l.seq++
	seq := l.seq
	l.cancel = cancel
	l.showWindow = nil
	l.progress = loginProgress{Sequence: seq, Status: "waiting", ExpiresAt: time.Now().Add(4 * time.Minute)}
	l.mu.Unlock()

	// 放到锁外调用：取消动作会触发对方 goroutine 的收尾，避免相互等待
	if prev != nil {
		prev()
	}
	return seq
}

// finish 会话自己结束时清理登记。仅当它仍是当前会话才清，
// 否则会把后来者的登记抹掉，导致后来者永远不会被 start 关闭。
func (l *loginSessions) finish(seq uint64) {
	l.mu.Lock()
	defer l.mu.Unlock()

	if l.seq == seq {
		l.cancel = nil
		l.showWindow = nil
		l.progress.WindowAvailable = false
		if l.progress.Status == "waiting" {
			l.progress.Status = "expired"
		}
	}
}

// Polling this state never launches a second browser or reads stored credentials.
func (l *loginSessions) snapshot() loginProgress {
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.progress.Status == "" {
		return loginProgress{Status: "idle"}
	}
	return l.progress
}

// Serialize saving with reset/start so a superseded QR cannot restore old login.
func (l *loginSessions) save(seq uint64, account *xiaohongshu.CurrentUser, save func() error) error {
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.seq != seq || l.progress.Status != "waiting" {
		return fmt.Errorf("login session superseded")
	}
	if err := save(); err != nil {
		l.progress.Status = "error"
		l.progress.Message = "扫码已确认，但登录保存失败，请重试。"
		return err
	}
	l.progress.Status = "saved"
	l.showWindow = nil
	l.progress.WindowAvailable = false
	l.progress.Account = account
	return nil
}

func (l *loginSessions) reset() {
	l.mu.Lock()
	prev := l.cancel
	l.seq++
	l.cancel = nil
	l.showWindow = nil
	l.progress = loginProgress{Sequence: l.seq, Status: "idle"}
	l.mu.Unlock()
	if prev != nil {
		prev()
	}
}

// Keep the focus action attached to exactly the browser that issued this QR.
func (l *loginSessions) setWindow(seq uint64, show func(context.Context) error) {
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.seq == seq && l.progress.Status == "waiting" {
		l.showWindow = show
		l.progress.WindowAvailable = true
	}
}
func (l *loginSessions) show(ctx context.Context) error {
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.progress.Status != "waiting" || l.showWindow == nil {
		return fmt.Errorf("没有正在等待扫码的窗口。登录成功或二维码过期后，窗口会自动关闭")
	}
	return l.showWindow(ctx)
}

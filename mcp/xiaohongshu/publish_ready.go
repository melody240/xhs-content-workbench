package xiaohongshu

import (
	"errors"
	"time"

	"github.com/go-rod/rod"
)

// This error is produced only before the publisher receives any content. It
// must never wrap an error from a click or from waiting for submission results.
type PublishPreparationError struct{ Cause error }

func (e *PublishPreparationError) Error() string { return e.Cause.Error() }
func (e *PublishPreparationError) Unwrap() error { return e.Cause }

const publishSurfaceState = `() => {
 const visible = e => !!e && e.getClientRects().length && getComputedStyle(e).visibility !== 'hidden';
 if (location.protocol === 'chrome-error:') return 'network_error';
 const text = document.body?.innerText || '';
 const blocked = [...document.querySelectorAll('[class*="captcha"], [class*="verify-dialog"], [class*="verify-modal"]')].some(visible);
 if (blocked || /请完成.{0,8}(验证|校验)|拖动.{0,8}(滑块|拼图)|安全验证/.test(text)) return 'verification_required';
 if (visible(document.querySelector('div.upload-content')) && [...document.querySelectorAll('div.creator-tab')].some(visible)) return 'ready';
 if (/扫码登录|手机号登录|验证码登录/.test(text) || /\/login(?:\/|$)/.test(location.pathname)) return 'login_required';
 return 'loading';
}`

func publishState(page *rod.Page) (string, error) {
	r, err := page.Timeout(3 * time.Second).Eval(publishSurfaceState)
	if err != nil {
		return "loading", err
	}
	return r.Value.Str(), nil
}

// Wait for publishing controls, not all remote images/analytics or global DOM
// stability. Each navigation has its own short deadline; a timed-out CDP call
// does not invalidate the context used to inspect the resulting page.
func preparePublishPage(page *rod.Page, tab string) error {
	pp := page.Timeout(60 * time.Second)
	// A saved creator cookie is neither necessary nor sufficient to prove that
	// this page can publish. Let the official page establish/validate its session.
	navErr := pp.Timeout(20 * time.Second).Navigate(urlOfPublic)
	if navErr != nil {
		state, err := publishState(pp)
		if err != nil || state == "loading" {
			return &PublishPreparationError{Cause: errors.New("打开小红书发布页超时或连接失败；尚未上传或提交。请检查发布页后重试。原因：" + navErr.Error())}
		}
	}
	if err := requirePublishSurface(pp.Timeout(20 * time.Second)); err != nil {
		return err
	}
	if err := mustClickPublishTab(pp.Timeout(10*time.Second), tab); err != nil {
		return err
	}
	if _, err := pp.Timeout(5 * time.Second).Element(`input[type="file"]`); err != nil {
		return errors.New("发布页未提供文件上传控件，本次没有上传或提交")
	}
	return nil
}

func requirePublishSurface(pp *rod.Page) error {
	if err := pp.Wait(rod.Eval(`() => (` + publishSurfaceState + `)() !== 'loading'`)); err != nil {
		return errors.New("发布页没有出现可用的上传控件；尚未上传或提交，请检查网络或在浏览器中查看发布页")
	}
	state, err := publishState(pp)
	if err != nil {
		return err
	}
	switch state {
	case "network_error":
		return errors.New("小红书发布页连接失败；本次没有上传或提交，请检查网络或代理")
	case "verification_required":
		return errors.New("小红书发布页需要本人完成安全验证；本次没有上传或提交，请使用浏览器填写并在真实页面完成验证")
	case "login_required":
		return errors.New("小红书网页已登录，但创作后台尚未登录；本次没有上传或提交，请在真实创作后台登录后再继续")
	case "ready":
	default:
		return errors.New("小红书发布页尚未就绪，本次没有上传或提交")
	}
	return nil
}

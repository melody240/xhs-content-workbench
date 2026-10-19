package xiaohongshu

import (
	"github.com/go-rod/rod"
	"github.com/pkg/errors"
)

// Wait for the controls the operation needs. An unrelated image or analytics
// request may keep window.load pending even when the account UI is usable.
const accountSurfaceReady = `() => {
	const visible = (e) => !!e && e.getClientRects().length > 0 && getComputedStyle(e).visibility !== "hidden";
	return visible(document.querySelector(".main-container .user .link-wrapper .channel")) ||
		visible(document.querySelector(".login-container .qrcode-img")) ||
        visible(document.querySelector('input[placeholder="登录探索更多内容"]'));
}`

func waitAccountSurface(page *rod.Page) error {
	if err := page.Wait(rod.Eval(accountSurfaceReady)); err != nil {
		return errors.Wrap(err, "account controls did not become ready")
	}
	return nil
}

// The application creates an empty userPageData before the profile request
// completes. Waiting only for __INITIAL_STATE__ returns a false empty profile.
const profileDataReady = `() => {
	const unwrap = (v) => v && (v.value !== undefined ? v.value : (v._value !== undefined ? v._value : v));
	const user = window.__INITIAL_STATE__ && window.__INITIAL_STATE__.user;
	const data = user && unwrap(user.userPageData);
	const info = data && data.basicInfo;
	return !!(info && info.nickname && info.redId && Array.isArray(unwrap(user.notes)));
}`

// Require the authenticated page's identity, not a particular sidebar layout.
// Guest state and an empty Vue ref cannot complete a scan.
const currentUserReady = `() => {
 const unwrap = v => v && (v.value !== undefined ? v.value : (v._value !== undefined ? v._value : v));
 const user = window.__INITIAL_STATE__ && window.__INITIAL_STATE__.user;
 const info = user && unwrap(user.userInfo);
 return !!(info && !info.guest && info.nickname && (info.userId || info.user_id));
}`

// A visible personal-profile control also proves the scan completed when the
// authenticated userInfo response is late or absent.
const loggedInControlReady = `() => {
 const e = document.querySelector(".main-container .user .link-wrapper .channel");
 return !!(e && e.getClientRects().length && getComputedStyle(e).visibility !== "hidden");
}`

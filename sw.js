/**
 * sw.js — 서비스워커 (Web Push 알림 전용)
 *
 * 역할:
 *  - push 이벤트 → 알림 표시
 *      · payload(JSON) 가 있으면 그대로 표시 (서버가 PHP ≥ 7.3 이라 암호화 발송한 경우)
 *      · payload 가 없으면 ajax/push.php?act=pending 에서 안 읽은 알림을 받아 표시
 *  - notificationclick → 해당 URL 을 이미 열린 탭이 있으면 포커스, 없으면 새로 열기
 *
 * fetch 핸들러는 일부러 두지 않음 — 오프라인 캐시 없이, 사이트 동작에 전혀 개입하지 않는다.
 * 이 파일은 사이트 루트(HP_BASE/sw.js) 에 있어야 scope 가 사이트 전체가 된다.
 */

var SW_VERSION = 'milk-push-1';
var API = new URL('./ajax/push.php', self.location.href).href;
var ICON = new URL('./favicon.php', self.location.href).href;

self.addEventListener('install', function () {
  self.skipWaiting();
});
self.addEventListener('activate', function (e) {
  e.waitUntil(self.clients.claim());
});

function showOne(item) {
  var title = item.title || '새 알림';
  var opts = {
    body: item.body || '',
    icon: ICON,
    badge: ICON,
    tag: item.tag || ('milk-' + Date.now()),
    renotify: true,
    data: { url: item.url || new URL('./', self.location.href).href, id: item.id || null }
  };
  return self.registration.showNotification(title, opts);
}

function fetchPending() {
  return self.registration.pushManager.getSubscription().then(function (sub) {
    if (!sub) return [];
    return fetch(API, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ act: 'pending', endpoint: sub.endpoint })
    }).then(function (r) { return r.ok ? r.json() : { items: [] }; })
      .then(function (j) { return (j && j.items) || []; })
      .catch(function () { return []; });
  });
}

self.addEventListener('push', function (e) {
  var data = null;
  if (e.data) {
    try { data = e.data.json(); } catch (err) {
      try { data = { title: e.data.text() }; } catch (err2) { data = null; }
    }
  }

  var job;
  if (data && (data.title || data.body)) {
    job = showOne(data);
  } else {
    // payload 없는 "깨우기" 푸시 — 서버에서 내용 조회
    job = fetchPending().then(function (items) {
      if (!items.length) {
        // 브라우저는 push 를 받으면 반드시 알림을 띄워야 함 (안 띄우면 "백그라운드 업데이트" 경고)
        return showOne({ title: '새 알림이 있어요', body: '사이트에서 확인해보세요.' });
      }
      if (items.length === 1) return showOne(items[0]);
      // 여러 개면 가장 최근 1개 + 나머지는 요약
      var first = items[0];
      return showOne({
        title: first.title,
        body: first.body + '\n외 ' + (items.length - 1) + '건',
        url: first.url,
        tag: 'milk-batch',
        id: first.id
      });
    });
  }
  e.waitUntil(job);
});

self.addEventListener('notificationclick', function (e) {
  e.notification.close();
  var url = (e.notification.data && e.notification.data.url) || new URL('./', self.location.href).href;
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (list) {
      var origin = new URL(url).origin;
      for (var i = 0; i < list.length; i++) {
        var c = list[i];
        if (c.url && c.url.indexOf(origin) === 0 && 'focus' in c) {
          return c.navigate ? c.navigate(url).then(function (w) { return w ? w.focus() : null; }).catch(function () { return c.focus(); }) : c.focus();
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(url);
    })
  );
});

// 브라우저가 구독을 갈아끼운 경우 (키 갱신 등) — 새 구독을 서버에 다시 등록
self.addEventListener('pushsubscriptionchange', function (e) {
  var appKey = e.oldSubscription && e.oldSubscription.options ? e.oldSubscription.options.applicationServerKey : null;
  e.waitUntil(
    self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: appKey })
      .then(function (sub) {
        return fetch(API, {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            act: 'renew',
            old_endpoint: e.oldSubscription ? e.oldSubscription.endpoint : '',
            subscription: sub.toJSON()
          })
        });
      })
      .catch(function () {})
  );
});

require('abortcontroller-polyfill/dist/polyfill-patch-fetch')

let supported = false
let $lastTouchTimestamp
let $touchEndedWithoutClickTimer

// preload
let $controller = null
let $url = null

let $fetchedPages = {}
let $urlToPreload = null
let $preloadTimer = null
let $isPreloading = false
let $isWaitingForCompletion = false

const $currentLocationWithoutHash = null
const $userAgent = window.navigator.userAgent

// options
let $delayBeforePreload = 50
let $cacheTTL = 5 * 60 * 1000 // ms
let $isPreloadable = null
let $transformURL = null

const $eventsCallbacks = {
    preload: [],
    receive: [],
    wait: [],
    change: [],
    restore: [],
    exit: [],
}

if ('pushState' in window.history && window.location.protocol !== 'file:') {
    supported = true

    const indexOfAndroid = $userAgent.indexOf('Android ')
    if (indexOfAndroid > -1) {
        // The stock browser in Android 4.0.3 through 4.3.1 supports pushState,
        // though it doesn't update the address bar.
        //
        // More problematic is that it has a bug on `popstate` when coming back
        // from a page not displayed through InstantClick: `location.href` is
        // undefined and `location.reload()` doesn't work.
        //
        // Android < 4.4 is therefore blacklisted, unless it's a browser known
        // not to have that latter bug.

        const androidVersion = parseFloat($userAgent.substr(indexOfAndroid + 'Android '.length))
        if (androidVersion < 4.4) {
            supported = false
            if (androidVersion >= 4) {
                const whitelistedBrowsersUserAgentsOnAndroid4 = [
                    / Chrome\//, // Chrome, Opera, Puffin, QQ, Yandex
                    / UCBrowser\//,
                    / Firefox\//,
                    / Windows Phone /, // WP 8.1+ pretends to be Android
                ]
                // eslint-disable-next-line no-plusplus
                for (let i = 0; i < whitelistedBrowsersUserAgentsOnAndroid4.length; i++) {
                    if (whitelistedBrowsersUserAgentsOnAndroid4[i].test($userAgent)) {
                        supported = true
                        break
                    }
                }
            }
        }
    }
}

function removeHash(url) {
    const index = url.indexOf('#')
    if (index === -1) {
        return url
    }
    return url.substr(0, index)
}

function isBlacklisted(element) {
    if (!element.hasAttribute) return true
    if (element.hasAttribute('data-no-instant')) return true
    if (element.hasAttribute('data-instant')) return false

    return false
}

function getParentLinkElement(element) {
    while (element && element.nodeName !== 'A') {
        element = element.parentNode
    }
    // `element` will be null if no link element is found
    return element
}

// //////////

function init(options = {}) {
    if (!supported) return

    $delayBeforePreload = options.delayBeforePreload || $delayBeforePreload
    $cacheTTL = options.cacheTTL !== undefined ? options.cacheTTL : $cacheTTL
    $transformURL = typeof options.transformURL === 'function' ? options.transformURL : $transformURL
    $isPreloadable = typeof options.isPreloadable === 'function' ? options.isPreloadable : $isPreloadable

    document.addEventListener('touchstart', touchstartListener, true)
    document.addEventListener('mouseover', mouseoverListener, true)
    document.addEventListener('click', clickListener, true)
}

function on(eventType, callback) {
    $eventsCallbacks[eventType].push(callback)
}

function preload(url) {
    if ($preloadTimer) {
        clearTimeout($preloadTimer)
        $preloadTimer = false
    }

    if (!url) {
        url = $urlToPreload
    }

    if ($isPreloading && (url === $url || $isWaitingForCompletion)) {
        return
    }

    $isPreloading = true
    $isWaitingForCompletion = false
    $url = url

    triggerPageEvent('preload', url)

    const request = typeof $transformURL === 'function'
        ? $transformURL(url)
        : url

    $controller = abortableFetch(request)
    $controller.ready
        .then(r => r.json())
        .then((body) => {
            const fetchedAt = new Date()
            triggerPageEvent('receive', url, body, { request, fetchedAt })
            $fetchedPages[url] = { body, fetchedAt }
            if ($isWaitingForCompletion) {
                $isWaitingForCompletion = false
                display($url)
            }
        })
        .catch(() => {
            if ($isWaitingForCompletion) {
                triggerPageEvent('exit', url, 'network error')
            }
        })
}

function display(url) {
    if ($preloadTimer || !$isPreloading) {
        // $preloadTimer:
        // Happens when there's a delay before preloading and that delay
        // hasn't expired (preloading didn't kick in).
        //
        // !$isPreloading:
        // A link has been clicked, and preloading hasn't been initiated.
        // It happens with touch devices when a user taps *near* the link,
        // causing `touchstart` not to be fired. Safari/Chrome will trigger
        // `mouseover`, `mousedown`, `click` (and others), but when that happens
        // we do nothing in `mouseover` as it may cause `click` not to fire (see
        // comment in `mouseoverListener`).
        //
        // It also happens when a user uses his keyboard to navigate (with Tab
        // and Return), and possibly in other non-mainstream ways to navigate
        // a website.

        if ($preloadTimer && $url && $url !== url) {
            // Happens when the user clicks on a link before preloading
            // kicks in while another link is already preloading.

            triggerPageEvent('exit', url, 'click occured while preloading planned')
            return
        }

        if (!hasValidCache(url)) {
            // Dont re-preload when the user clicks on a link that is preloaded
            preload(url)
            triggerPageEvent('wait')
            $isWaitingForCompletion = true // Must be set *after* calling `preload`
            return
        }
    }
    if ($isWaitingForCompletion) {
        // The user clicked on a link while a page to display was preloading.
        // Either on the same link or on another link. If it's the same link
        // something might have gone wrong (or he could have double clicked, we
        // don't handle that case), so we send him to the page without pjax.
        // If it's another link, it hasn't been preloaded, so we redirect the
        // user to it.
        triggerPageEvent('exit', url, 'clicked on a link while waiting for another page to display')
        return
    }
    if (!hasValidCache(url)) {
        triggerPageEvent('wait')
        $isWaitingForCompletion = true
        return
    }
    if (hasValidCache(url)) {
        triggerPageEvent('change', url, $fetchedPages[url])
    }
}

function hasValidCache(url) {
    // found & is not expired
    return $fetchedPages[url] && new Date() - $fetchedPages[url].fetchedAt < $cacheTTL
}

function purge(url) {
    if ($fetchedPages[url]) {
        delete $fetchedPages[url]
    }
}

function purgeAll() {
    $fetchedPages = {}
}

function getData(url) {
    return $fetchedPages[url]
}

// Events

function clickListener(event) {
    if ($touchEndedWithoutClickTimer) {
        clearTimeout($touchEndedWithoutClickTimer)
        $touchEndedWithoutClickTimer = false
    }

    if (event.defaultPrevented) {
        return
    }

    const linkElement = getParentLinkElement(event.target)

    if (!linkElement || !isPreloadable(linkElement)) {
        return
    }

    // Check if it's opening in a new tab
    if (event.button !== 0 // Chrome < 55 fires a click event when the middle mouse button is pressed
        || event.metaKey
        || event.ctrlKey) {
            return
    }

    event.preventDefault()
    display(linkElement.href)
}

function mouseoverListener(event) {
    if ($lastTouchTimestamp > (+new Date() - 500)) {
        // On a touch device, if the content of the page change on mouseover
        // click is never fired and the user will need to tap a second time.
        // https://developer.apple.com/library/content/documentation/AppleApplications/Reference/SafariWebContent/HandlingEvents/HandlingEvents.html#//apple_ref/doc/uid/TP40006511-SW4
        //
        // Content change could happen in the `preload` event, so we stop there.
        return
    }

    const linkElement = getParentLinkElement(event.target)

    if (!linkElement) {
        return
    }

    if (linkElement === getParentLinkElement(event.relatedTarget)) {
        // Happens when mouseout-ing and mouseover-ing child elements of the same link element
        return
    }

    if (!isPreloadable(linkElement) || hasValidCache(linkElement.href)) {
        return
    }

    linkElement.addEventListener('mouseout', mouseoutListener)

    if (!$isWaitingForCompletion) {
        $urlToPreload = linkElement.href
        $preloadTimer = setTimeout(preload, $delayBeforePreload)
    }
}

function mouseoutListener(event) {
    if (getParentLinkElement(event.target) === getParentLinkElement(event.relatedTarget)) {
        // Happens when mouseout-ing and mouseover-ing child elements of the same link element,
        // we don't want to stop preloading then.
        return
    }

    if ($preloadTimer) {
        clearTimeout($preloadTimer)
        $preloadTimer = false
        return
    }

    if (!$isPreloading || $isWaitingForCompletion) {
        return
    }

    $controller.abort()
    setPreloadingAsHalted()
}

function touchstartListener(event) {
    $lastTouchTimestamp = +new Date()

    const linkElement = getParentLinkElement(event.target)

    if (!linkElement
        || !isPreloadable(linkElement)
        || hasValidCache(linkElement.href)
    ) {
        return
    }

    if ($touchEndedWithoutClickTimer) {
        clearTimeout($touchEndedWithoutClickTimer)
        $touchEndedWithoutClickTimer = false
    }

    linkElement.addEventListener('touchend', touchendAndTouchcancelListener)
    linkElement.addEventListener('touchcancel', touchendAndTouchcancelListener)

    preload(linkElement.href)
}

function touchendAndTouchcancelListener() {
    if (!$isPreloading || $isWaitingForCompletion) {
        return
    }

    $touchEndedWithoutClickTimer = setTimeout(handleTouchendWithoutClick, 500)
}

//------------------------------------

function handleTouchendWithoutClick() {
    $controller.abort()
    setPreloadingAsHalted()
}

function setPreloadingAsHalted() {
    $isPreloading = false
    $isWaitingForCompletion = false
}

function abortableFetch(request, opts) {
    const controller = new AbortController()
    const signal = controller.signal

    return {
        abort: () => controller.abort(),
        ready: fetch(request, { ...opts, signal }),
    }
}

function triggerPageEvent(eventType, arg1, arg2, arg3) {
    let returnValue = false
    // eslint-disable-next-line no-plusplus
    for (let i = 0; i < $eventsCallbacks[eventType].length; i++) {
        if (eventType === 'receive') {
            const altered = $eventsCallbacks[eventType][i](arg1, arg2, arg3)
            if (altered) {
                /* Update args for the next iteration of the loop. */
                if ('body' in altered) {
                    arg2 = altered.body
                }
                if ('title' in altered) {
                    arg3 = altered.title
                }

                returnValue = altered
            }
        } else {
            $eventsCallbacks[eventType][i](arg1, arg2, arg3)
        }
    }
    return returnValue
}

function isPreloadable(linkElement) {
    const domain = `${window.location.protocol}//${window.location.host}`

    if (linkElement.target // target="_blank" etc.
        || linkElement.hasAttribute('download')
        || linkElement.href.indexOf(`${domain}/`) !== 0 // Another domain, or no href attribute
        || (linkElement.href.indexOf('#') > -1
            && removeHash(linkElement.href) === $currentLocationWithoutHash) // Anchor
        || isBlacklisted(linkElement)
        || (typeof $isPreloadable === 'function' ? !$isPreloadable(linkElement.href) : false)
    ) {
        return false
    }

    return true
}

module.exports = {
    supported,
    init,
    on,
    preload,
    display,
    purge,
    purgeAll,
    getData,
    hasValidCache,
}

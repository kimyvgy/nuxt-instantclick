# @kimyvgy/nuxt-instantclick

Prefetch page's data on link hover for Nuxt.js. (Instantclick port for Nuxt).

## How it works

1. User hovers on the link
2. Parse the link and prefetch Json API to prepare data (if prefetchable)
3. User click on a link, `change` event will fire (url, response data are included)
4. Your callback hooked by `change` event will dispatch => you can set data into Vuex store, and render route as normally.

## Install

You can install with NPM/Yarn:

```bash
# yarn
yarn add @kimyvgy/nuxt-instantclick

# or npm
npm install @kimyvgy/nuxt-instantclick
```

## Usage

1. Create a nuxt plugin for the cliend-side only - `./plugins/instantclick.client.js` then activate it in `nuxt.config.js` file:

```javascript
// ...

plugins: [
    '@/plugins/instantclick.client.js',
    // ...
],
```

2. Init Nuxt Instantclick, in `@/plugins/instantclick.client.js`:

```javascript
import InstantClick from '@kimyvgy/nuxt-instantclick'

export default ({ store, app: { router } }) => {
    const options = {
        // delay time before preloading page data
        delayBeforePreload: 0, // 0 ms

        // Time-to-live of preloaded data
        cacheTTL: 5 * 60 * 1000, // 5 min

        isPreloadable: (url) => {
            // please return `true` if the URL is preloadable.
            // nuxt-instantclick will have no action if returning `false`.
            const postPageReg = /\/posts\/.+$/
            return postPageReg.test(url)
        },

        transformURL: (url) => {
            // return URL string that will be used to preload page data.
            const slug = url.match(/([^/-]+)$/)[1]
            return `/api/p/${hashId}`
        },
    }


    InstantClick.init(options)

    // hooked by events
    InstantClick.on('change', async (url, { body, fetchedAt }) => {
        const expired = new Date() - fetchedAt > options.cacheTTL

        if (expired) {
            router.push(removeHostname(url))
            return
        }

        // Apply data then navigate to page.
        store.dispatch('save_preloaded_data', body)
        router.push(removeHostname(url))
    })

    InstantClick.on('exit', (url) => {
        router.push(removeHostname(url))
    })
}

function removeHostname (url) {
    return url.replace(/^https?:\/\/[^\/]+/, '');
}
```

3. Add logic to prevent fetch new data in `asyncData/fetch` method if preloaded data is not expired. Example:

```javascript
async asyncData({ route }) {
    if (process.client && InstantClick.hasValidCache(route.fullPath)) {
        return { data: InstantClick.getData(window.location.fullPath) }
    } else {
        const data = await fetch('/api/...').then(...)
        return { data }
    }
}
```

### Events

- preload:  start preload URL
- received: data received
- change:   user clicked on the link, please change page with preloaded data.
- exit:     error when processing click behavior: fetching error / data expired...

const searchEngines = {
    "www.google.com": "q",
    "duckduckgo.com": "q",
    "www.bing.com": "q",
    "search.yahoo.com": "p",
    "ecosia.org": "q"
};

let customTLDs = { ...defaultCustomTLDs };
let customMounts = {};

// Load user mounts and customTLDs from storage
let storageInitPromise = browser.storage.local.get({ customMounts: {}, customTLDs: null }).then(res => {
    customMounts = res.customMounts || {};
    if (res.customTLDs) {
        customTLDs = res.customTLDs;
    } else {
        browser.storage.local.set({ customTLDs: customTLDs });
    }
});

// Update memory instantly if user changes settings in Options page
browser.storage.onChanged.addListener((changes, area) => {
    if (area === "local") {
        if (changes.customMounts) {
            customMounts = changes.customMounts.newValue || {};
        }
        if (changes.customTLDs) {
            customTLDs = changes.customTLDs.newValue || {};
        }
    }
});

function reverseDomain(domainStr) {
    let parts = domainStr.split('.');
    let firstPart = parts[0].toLowerCase();

    if (customTLDs[firstPart] !== undefined) {
        parts[0] = customTLDs[firstPart];
    }
    return parts.reverse().join('.');
}

function parseTopDownTarget(targetStr) {
    let hash = "";
    let search = "";

    let hashIdx = targetStr.indexOf('#');
    if (hashIdx !== -1) {
        hash = targetStr.slice(hashIdx);
        targetStr = targetStr.slice(0, hashIdx);
    }

    let queryIdx = targetStr.indexOf('?');
    if (queryIdx !== -1) {
        search = targetStr.slice(queryIdx);
        targetStr = targetStr.slice(0, queryIdx);
    }

    let parts = targetStr.split('/');
    let domain = parts[0];
    let path = parts.length > 1 ? "/" + parts.slice(1).join('/') : "";

    return { domain, path, search, hash };
}

function joinPaths(basePath, extraPath) {
    if (!extraPath || extraPath === "/") return basePath || "";
    if (!basePath) return extraPath;
    if (basePath.endsWith('/') && extraPath.startsWith('/')) {
        return basePath + extraPath.slice(1);
    }
    if (!basePath.endsWith('/') && !extraPath.startsWith('/')) {
        return basePath + "/" + extraPath;
    }
    return basePath + extraPath;
}

// Resolves a single expanded top-down target into a final destination or scoped search URL
function resolveSingleTarget(rawTarget, extraPath, extraSearch, extraHash, searchContext) {
    let userParsed = parseTopDownTarget(rawTarget);
    let pathParts = userParsed.domain.split('/');
    let queryDomain = pathParts[0].toLowerCase();
    let combinedUserPath = joinPaths(
        pathParts.length > 1 ? "/" + pathParts.slice(1).join('/') : "",
        joinPaths(userParsed.path, extraPath)
    );

    let expandedDomain = expandCustomMounts(queryDomain, customMounts);
    let parsedExpanded = parseTopDownTarget(expandedDomain);

    if (!parsedExpanded.domain.includes('.') || !isTopDown(parsedExpanded.domain, customMounts, customTLDs)) {
        return null;
    }

    let standardDomain = reverseDomain(parsedExpanded.domain);
    let finalPath = joinPaths(parsedExpanded.path, combinedUserPath);

    // SCOPED TREE SEARCH
    if (searchContext && searchContext.keywords) {
        let cleanPath = finalPath === "/" ? "" : finalPath.replace(/\/$/, "");
        let scopedQuery = `site:${standardDomain}${cleanPath} ${searchContext.keywords}`;
        let searchUrl = new URL(searchContext.baseUrl.toString());
        searchUrl.searchParams.set(searchContext.param, scopedQuery);
        return searchUrl.toString();
    }

    // Ignore bare trailing-dot TLD queries (e.g. "edu.") when no search terms exist
    if (parsedExpanded.domain.endsWith('.')) return null;

    let finalUrl = new URL("https://" + standardDomain);
    finalUrl.pathname = finalPath;

    let mountParams = new URLSearchParams(parsedExpanded.search);
    let targetParams = new URLSearchParams(userParsed.search);
    let userParams = new URLSearchParams(extraSearch);

    targetParams.forEach((v, k) => mountParams.set(k, v));
    userParams.forEach((v, k) => mountParams.set(k, v));
    finalUrl.search = mountParams.toString();

    let finalHash = extraHash || userParsed.hash || parsedExpanded.hash;
    if (finalHash) {
        finalUrl.hash = finalHash;
    }

    return finalUrl.toString();
}

// Redirects current tab to the first resolved URL and spawns background tabs for the rest
function dispatchUrls(resolvedUrls) {
    for (let i = 1; i < resolvedUrls.length; i++) {
        browser.tabs.create({ url: resolvedUrls[i], active: false });
    }
    return { redirectUrl: resolvedUrls[0] };
}

browser.webRequest.onBeforeRequest.addListener(
    async function (details) {
        if (details.type !== "main_frame") return;

        if (details.originUrl && details.originUrl.startsWith("http")) {
            return;
        }

        await storageInitPromise;

        let url = new URL(details.url);

        // CASE 1: Direct navigation (also decodes %7B / %7D in pathname for path braces like .r/{a,b})
        let decodedPathname = url.pathname.replace(/%7B/gi, '{').replace(/%7D/gi, '}');
        let rawDirectInput = url.hostname + (decodedPathname === "/" ? "" : decodedPathname);
        let directCandidates = expandTargets(rawDirectInput, customMounts);

        let resolvedDirect = directCandidates
            .map(target => resolveSingleTarget(target, "", url.search, url.hash, null))
            .filter(Boolean);

        if (resolvedDirect.length > 0 && resolvedDirect.length === directCandidates.length) {
            return dispatchUrls(resolvedDirect);
        }

        // CASE 2: Search engine query intercept (Navigation + Brace Expansion + Scoped Tree Search)
        let searchParam = searchEngines[url.hostname];
        if (searchParam && url.searchParams.has(searchParam)) {
            let query = url.searchParams.get(searchParam).trim();

            if (query.toLowerCase().startsWith("site:")) {
                return;
            }

            // Normalize spaces inside "{a, b}" first so we only split on whitespace outside braces
            let normalizedQuery = normalizeBraces(query);
            let spaceIdx = normalizedQuery.search(/\s/);
            let targetToken = spaceIdx === -1 ? normalizedQuery : normalizedQuery.slice(0, spaceIdx);
            let searchKeywords = spaceIdx === -1 ? "" : normalizedQuery.slice(spaceIdx).trim();

            let candidates = expandTargets(targetToken, customMounts);
            let searchContext = searchKeywords ? { baseUrl: url, param: searchParam, keywords: searchKeywords } : null;

            let resolvedSearch = candidates
                .map(target => resolveSingleTarget(target, "", "", "", searchContext))
                .filter(Boolean);

            if (resolvedSearch.length > 0 && resolvedSearch.length === candidates.length) {
                return dispatchUrls(resolvedSearch);
            }
        }
    },
    { urls: ["<all_urls>"], types: ["main_frame"] },
    ["blocking"]
);
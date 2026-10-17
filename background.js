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

// UNIVERSAL SEARCH INTERCEPT: Detects search query parameter across global & self-hosted engines
function getSearchParam(url) {
    const host = url.hostname.toLowerCase();
    const path = url.pathname.toLowerCase();

    if (/(^|\.)google\.[a-z.]+$/.test(host)) return "q";
    if (/(^|\.)(duckduckgo|bing|kagi|startpage|qwant)\.com$/.test(host)) return "q";
    if (host === "search.brave.com" || host === "ecosia.org" || host === "www.ecosia.org") return "q";
    if (/(^|\.)yahoo\.[a-z.]+$/.test(host)) return "p";
    if (host === "search.naver.com" || host === "search.daum.net") return "query";
    if (/(^|\.)yandex\.[a-z.]+$/.test(host)) return "text";
    if (/(^|\.)baidu\.com$/.test(host)) return "wd";

    // Fallback for self-hosted search engines (SearXNG, Whoogle, etc.)
    if (path === "/search" || path === "/web") {
        for (const param of ["q", "query", "p", "text"]) {
            if (url.searchParams.has(param)) return param;
        }
    }
    return null;
}

function reverseDomain(domainStr) {
    let parts = domainStr.split('.');
    let firstPart = parts[0].toLowerCase();

    if (customTLDs[firstPart] !== undefined) {
        parts[0] = customTLDs[firstPart];
    }
    return parts.reverse().join('.');
}

// Converts a standard URL (e.g. from "@") into a Top-Down target string
function standardUrlToTopDown(urlStr) {
    let parsed = new URL(urlStr);
    let topDownDomain = parsed.hostname.toLowerCase().split('.').reverse().join('.');
    let cleanPath = parsed.pathname === "/" ? "" : parsed.pathname.replace(/\/$/, "");
    return topDownDomain + cleanPath + parsed.search + parsed.hash;
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

        // CASE 1: Direct navigation (decodes %7B / %7D in path, query, and hash)
        let decodeBraces = s => s.replace(/%7B/gi, '{').replace(/%7D/gi, '}');
        let rawDirectInput = url.hostname
            + (url.pathname === "/" ? "" : decodeBraces(url.pathname))
            + decodeBraces(url.search)
            + decodeBraces(url.hash);

        let directCandidates = expandTargets(rawDirectInput, customMounts);

        let resolvedDirect = directCandidates
            .map(target => resolveSingleTarget(target, "", "", "", null))
            .filter(Boolean);

        if (resolvedDirect.length > 0 && resolvedDirect.length === directCandidates.length) {
            return dispatchUrls(resolvedDirect);
        }

        // CASE 2: Universal Search Engine Intercept
        let searchParam = getSearchParam(url);
        if (searchParam && url.searchParams.has(searchParam)) {
            let query = url.searchParams.get(searchParam).trim();

            if (query.toLowerCase().startsWith("site:")) {
                return;
            }

            // INLINE MOUNT CREATION: Matches ".alias := target", ".alias := @", or ".alias :="
            let assignMatch = query.match(/^(\.[a-zA-Z0-9_-]+)\s*:=\s*(.*)$/);
            if (assignMatch) {
                let mountKey = assignMatch[1].toLowerCase();
                let rawTarget = assignMatch[2].trim();

                // 1. Delete mount if right-hand side is empty (e.g. ".s :=")
                if (rawTarget === "") {
                    delete customMounts[mountKey];
                    await browser.storage.local.set({ customMounts });
                    return { redirectUrl: browser.runtime.getURL("options.html") };
                }

                // 2. Mount current active tab if right-hand side is "@" (e.g. ".go := @")
                if (rawTarget === "@") {
                    if (details.tabId !== -1) {
                        let tab = await browser.tabs.get(details.tabId);
                        if (tab && tab.url && tab.url.startsWith("http")) {
                            customMounts[mountKey] = standardUrlToTopDown(tab.url);
                            await browser.storage.local.set({ customMounts });
                            return { redirectUrl: tab.url };
                        }
                    }
                    return;
                }

                // 3. Standard inline assignment (e.g. ".s := .r/soccer" or ".s := com.reddit/r/soccer")
                let cleanTarget = rawTarget.replace(/^https?:\/\//i, '').replace(/\/$/, '').toLowerCase();
                if (isTopDown(cleanTarget, customMounts, customTLDs)) {
                    customMounts[mountKey] = cleanTarget;
                    await browser.storage.local.set({ customMounts });

                    // Immediately resolve and navigate to the newly created mount
                    let newCandidates = expandTargets(mountKey, customMounts);
                    let resolvedNew = newCandidates
                        .map(target => resolveSingleTarget(target, "", "", "", null))
                        .filter(Boolean);

                    if (resolvedNew.length > 0) {
                        return dispatchUrls(resolvedNew);
                    }
                }
                return;
            }

            // STANDARD QUERY PROCESSING (Navigation + Brace Expansion + Scoped Tree Search)
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
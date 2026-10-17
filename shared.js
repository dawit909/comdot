// top 338 by traffic
const TLDs = ["com", "net", "org", "jp", "de", "uk", "fr", "br", "it", "ru", "es", "me", "gov", "pl", "ca", "au", "cn", "co", "in", "nl", "edu", "info", "eu", "ch", "id", "at", "kr", "cz", "mx", "be", "tv", "se", "tr", "tw", "al", "ua", "ir", "vn", "cl", "sk", "ly", "cc", "to", "no", "fi", "us", "pt", "dk", "ar", "hu", "tk", "gr", "il", "news", "ro", "my", "biz", "ie", "za", "nz", "sg", "ee", "th", "io", "xyz", "pe", "bg", "hk", "rs", "lt", "link", "ph", "club", "si", "site", "mobi", "by", "cat", "wiki", "la", "ga", "xxx", "cf", "hr", "ng", "jobs", "online", "kz", "ug", "gq", "ae", "is", "lv", "pro", "fm", "tips", "ms", "sa", "app", "lat", "pk", "ws", "top", "xn", "pw", "ai", "kw", "ml", "su", "lu", "nu", "ec", "uy", "az", "ma", "st", "asia", "im", "am", "email", "ke", "eg", "live", "md", "uz", "today", "ge", "ba", "bo", "blog", "lk", "do", "one", "ve", "media", "sh", "vip", "life", "guru", "mp", "int", "tz", "desi", "jo", "mk", "np", "py", "mu", "mn", "re", "travel", "tn", "gd", "sn", "cam", "shop", "mil", "tokyo", "gg", "kg", "cr", "li", "cu", "hn", "eus", "rocks", "bd", "dev", "fun", "video", "gt", "bz", "space", "store", "mt", "name", "work", "porn", "pub", "kh", "icu", "as", "cy", "pr", "careers", "ps", "dz", "iq", "ltd", "pa", "sv", "qa", "design", "sc", "sy", "aero", "tech", "best", "scot", "win", "ni", "bzh", "lb", "city", "digital", "red", "pg", "world", "ag", "ci", "report", "ac", "center", "ad", "ovh", "om", "cloud", "press", "zw", "vg", "cx", "website", "plus", "page", "bs", "cd", "gh", "moe", "help", "download", "ao", "cm", "af", "click", "mg", "tm", "na", "pics", "mv", "market", "rw", "fo", "fj", "tl", "gratis", "art", "mc", "mo", "gal", "coop", "nc", "run", "mz", "tj", "zone", "cv", "bh", "place", "gy", "agency", "kn", "mm", "bid", "bj", "je", "gs", "global", "lol", "tube", "lc", "bm", "ninja", "bn", "review", "bi", "ht", "sm", "ax", "pm", "ink", "vc", "so", "tel", "cw", "uno", "casa", "network", "buzz", "mw", "vu", "guide", "bf", "mq", "sex", "sr", "zm", "onl", "vet", "bw", "jm", "bar", "gp", "pf", "ne", "va", "bt", "sd", "expert", "kim", "africa", "mr", "gi", "tg", "cg", "ls", "sb", "ck", "gf", "yt", "dm", "realtor", "aw", "sz", "london", "et", "ky", "cool", "lr", "bb", "support", "taipei", "sl", "company", "dj", "social", "gm", "xn", "love"];

// top 3 by traffic
const superPrimaryTLDs = ["com", "net", "org"];

// top 30 by traffic
const primaryTLDs = ["com", "net", "org", "jp", "de", "uk", "fr", "br", "it", "ru", "es", "me", "gov", "pl", "ca", "au", "cn", "co", "in", "nl", "edu", "info", "eu", "ch", "id"];

const defaultCustomTLDs = {
    "": "com",
    "c": "com",
    "n": "net",
    "o": "org",
};

const BRACE_REGEX = /\{([^{}]*(?:,|\.\.)[^{}]*)\}/;
const MAX_TABS = 20;

// Strips spaces inside "{a, b}" or "{25, 50..100}" so space-splitting won't break brace groups
function normalizeBraces(str) {
    if (!str || !str.includes('{')) return str;
    return str.replace(/\{([^{}]*)\}/g, (match, inner) => {
        if (!inner.includes(',') && !inner.includes('..')) return match;
        return '{' + inner.replace(/\s*,\s*/g, ',').replace(/\s*\.\.\s*/g, '..').trim() + '}';
    });
}

// Parses a single brace group's inner content into an array of expanded values
function parseBraceGroup(inner) {
    // 1. Numeric ranges: {1..5}, {25..100..25}, or {25,50..100}
    let numStepMatch = inner.match(/^(-?\d+)\.\.(-?\d+)(?:\.\.(-?\d+))?$/);
    let numSeriesMatch = !numStepMatch && inner.match(/^(-?\d+),(-?\d+)\.\.(-?\d+)$/);

    if (numStepMatch || numSeriesMatch) {
        let startStr = numStepMatch ? numStepMatch[1] : numSeriesMatch[1];
        let endStr = numStepMatch ? numStepMatch[2] : numSeriesMatch[3];
        let start = Number(startStr);
        let end = Number(endStr);

        let step = 1;
        if (numStepMatch && numStepMatch[3] !== undefined) {
            step = Math.abs(Number(numStepMatch[3]));
        } else if (numSeriesMatch) {
            step = Math.abs(Number(numSeriesMatch[2]) - start);
        }

        if (step === 0) return [inner];

        let padLength = (startStr.replace('-', '').startsWith('0') && startStr.replace('-', '').length > 1)
            ? Math.max(startStr.replace('-', '').length, endStr.replace('-', '').length)
            : 0;

        let values = [];
        let dir = start <= end ? 1 : -1;

        for (let val = start; dir > 0 ? val <= end : val >= end; val += dir * step) {
            if (values.length >= MAX_TABS) break;
            let formatted = padLength > 0
                ? (val < 0 ? '-' : '') + String(Math.abs(val)).padStart(padLength, '0')
                : String(val);
            values.push(formatted);
        }

        return values.length > 0 ? values : [inner];
    }

    // 2. Alphabetical ranges: {a..e}, {a..z..2}, or {a,c..k}
    let alphaStepMatch = inner.match(/^([a-zA-Z])\.\.([a-zA-Z])(?:\.\.(-?\d+))?$/);
    let alphaSeriesMatch = !alphaStepMatch && inner.match(/^([a-zA-Z]),([a-zA-Z])\.\.([a-zA-Z])$/);

    if (alphaStepMatch || alphaSeriesMatch) {
        let startChar = alphaStepMatch ? alphaStepMatch[1] : alphaSeriesMatch[1];
        let endChar = alphaStepMatch ? alphaStepMatch[2] : alphaSeriesMatch[3];

        // Require matching case so ranges don't step through ASCII symbols (91–96) between 'Z' and 'a'
        let isLower = c => c >= 'a' && c <= 'z';
        let sameCase = (isLower(startChar) === isLower(endChar)) &&
            (!alphaSeriesMatch || isLower(alphaSeriesMatch[2]) === isLower(startChar));

        if (sameCase) {
            let start = startChar.charCodeAt(0);
            let end = endChar.charCodeAt(0);

            let step = 1;
            if (alphaStepMatch && alphaStepMatch[3] !== undefined) {
                step = Math.abs(Number(alphaStepMatch[3]));
            } else if (alphaSeriesMatch) {
                step = Math.abs(alphaSeriesMatch[2].charCodeAt(0) - start);
            }

            if (step === 0) return [inner];

            let values = [];
            let dir = start <= end ? 1 : -1;

            for (let code = start; dir > 0 ? code <= end : code >= end; code += dir * step) {
                if (values.length >= MAX_TABS) break;
                values.push(String.fromCharCode(code));
            }

            return values.length > 0 ? values : [inner];
        }
    }

    // 3. Standard comma-separated list: {a,b,c}
    if (inner.includes(',')) {
        return inner.split(',').map(s => s.trim()).filter(Boolean);
    }

    return [inner];
}

// Expands Unix brace expressions into an array of strings
function expandBraces(str) {
    if (!str || !str.includes('{')) return [str];

    let results = [normalizeBraces(str)];

    while (results.some(r => BRACE_REGEX.test(r)) && results.length < MAX_TABS) {
        let nextResults = [];
        for (let item of results) {
            let match = item.match(BRACE_REGEX);
            if (!match) {
                nextResults.push(item);
            } else {
                let options = parseBraceGroup(match[1]);
                for (let opt of options) {
                    nextResults.push(item.slice(0, match.index) + opt + item.slice(match.index + match[0].length));
                    if (nextResults.length >= MAX_TABS) break;
                }
            }
            if (nextResults.length >= MAX_TABS) break;
        }
        results = nextResults;
    }

    return results.slice(0, MAX_TABS);
}

// Unified Validation logic passed a dynamic map to resolve scope issues
function isTopDown(hostLower, customMounts, customTLDsMap) {
    if (!hostLower || hostLower === ".") return false;

    // Support validating brace-expanded targets (e.g. in options.js)
    if (hostLower.includes('{') && hostLower.includes('}')) {
        let expandedList = expandBraces(hostLower);
        return expandedList.length > 0 && expandedList.every(item => isTopDown(item, customMounts, customTLDsMap));
    }

    if (hostLower.includes(' ')) return false;

    // Strip out path, query (?), and fragment (#) to isolate the domain part
    let cleanHost = hostLower.split(/[\/\?#]/)[0];
    let parts = cleanHost.split('.');
    if (parts.length < 2) return false;

    let firstPart = parts[0].toLowerCase();
    let lastPart = parts[parts.length - 1].toLowerCase();

    if (firstPart === "" && parts[1] && customMounts && (customMounts[parts[1]] !== undefined || customMounts["." + parts[1]] !== undefined)) return true;
    if (customTLDsMap && customTLDsMap[firstPart] !== undefined) return true;

    if (superPrimaryTLDs.includes(lastPart)) return false;
    if (primaryTLDs.includes(firstPart)) return true;
    if (TLDs.includes(firstPart) && !TLDs.includes(lastPart)) return true;

    return false;
}

function expandCustomMounts(hostLower, customMounts) {
    if (hostLower === "") return hostLower;

    let splitBySlash = hostLower.split("/");
    let splitByDot = splitBySlash[0].split(".");
    if (splitByDot.length === 0) return hostLower;

    let first = splitByDot[0];
    let second = splitByDot[1];
    if (first !== "") return hostLower;

    let subdomains = splitByDot.slice(2);
    let subpaths = splitBySlash.slice(1);
    let subbed = "";
    let beenawhile = false;

    while (first === "" && customMounts && customMounts["." + second] && !(customMounts["." + second].includes("/") && subdomains.length > 0)) {
        let candidate = customMounts["." + second];

        // If the mount target itself is a brace expression (e.g. .morning -> {.r/soccer, .github}),
        // replace the mount key directly and let expandTargets() unpack the braces next.
        if (candidate.includes('{')) {
            let subStr = subdomains.length === 0 ? "" : "." + subdomains.join(".");
            let pathStr = subpaths.length === 0 ? "" : "/" + subpaths.join("/");
            return candidate + subStr + pathStr;
        }

        beenawhile = true;
        subbed = candidate;
        splitBySlash = subbed.split("/");
        splitByDot = splitBySlash[0].split(".");

        subdomains.unshift(...splitBySlash[0].split(".").slice(2));
        subpaths.unshift(...splitBySlash.slice(1));

        first = splitByDot[0];
        second = splitByDot[1];
    }

    if (!beenawhile) {
        return hostLower;
    }
    let subdomainsStr = (subdomains.length === 0 ? "" : "." + subdomains.join("."));
    let pathsStr = (subpaths.length === 0 ? "" : "/" + subpaths.join("/"));

    first = subbed.split("/")[0].split(".")[0];
    second = subbed.split("/")[0].split(".")[1];
    return first + "." + second + subdomainsStr + pathsStr;
}

// Interleaves brace expansion and custom mount expansion until fully resolved
function expandTargets(rawInput, customMounts) {
    let queue = [rawInput];
    for (let depth = 0; depth < 5; depth++) {
        let nextQueue = [];
        let changed = false;

        for (let item of queue) {
            for (let braced of expandBraces(item)) {
                let mounted = expandCustomMounts(braced, customMounts);
                if (mounted !== item) changed = true;
                nextQueue.push(mounted);
            }
        }
        queue = nextQueue;
        if (!changed && !queue.some(x => BRACE_REGEX.test(x))) break;
    }
    return queue;
}
const HOST_APPLICATION = 'com.kiwidude.calibre_search'
const SEARCH_ACTION = 'SEARCH';

const ILLEGAL_CONTENTSCRIPT_PROTOCOLS = ['view-source', 'about', 'moz-extension'];
const ILLEGAL_FILETYPES = ['PDF'];
const ILLEGAL_CONTENTSCRIPT_DOMAINS = ['accounts-static.cdn.mozilla.net', 'accounts.firefox.com', 'addons.cdn.mozilla.net',
    'addons.mozilla.org', 'api.accounts.firefox.com', 'content.cdn.mozilla.net', 'content.cdn.mozilla.net',
    'discovery.addons.mozilla.org', 'input.mozilla.org', 'install.mozilla.org', 'oauth.accounts.firefox.com',
    'profile.accounts.firefox.com', 'support.mozilla.org', 'sync.services.mozilla.com', 'testpilot.firefox.com'];

const MENU_ID = 'calibre-search';

let libraryName = 'CalibreBooks';
let replaceExpressions = '';

let fallbackMode = false;
let activeTabId = 0;

// Error logging
function onSuccess(n) {
    if (chrome.runtime.lastError) {
        console.log(`Error: ${chrome.runtime.lastError}`);
    }
}
function onError(error) {
    console.log(`Error: ${error}`);
}
  
// Get user prefs.
function getOptions() {
    let gettingItem = chrome.storage.sync.get({
		libraryName: 'Calibre Library',
		replaceExpressions: ''
	});
    gettingItem.then((response) => {
        libraryName = response.libraryName;
        replaceExpressions = response.replaceExpressions;
        updateContextMenu();
    });
}

// Assuming that will get passed a string like: /\([^\)]*\)/g
// We will strip off the leading / and trailing /
function convertStringToRegExp(text) {
    text = text.substring(1);
    const lastSlash = text.lastIndexOf('/');
    let flags = '';
    if (lastSlash >= 0) {
        flags = text.substring(lastSlash + 1);
        text = text.substring(0, lastSlash);
    }
    if (text.trim()) {
        return new RegExp(text, flags)
    }
    return null;
}

// The user can configure their own set of replacement expressions to apply.
// These can be either 'words' or defined as ECMAScript regular expressions, e.g.
//    by
//    series
//    /\([^\)]*\)/g
//    /\:/g
// We will replace the matches with spaces, then strip all the double spaces out at end.
function applyCustomReplacements(rawQuery) {
    if (!replaceExpressions) return rawQuery;

    const lines = replaceExpressions.split(/\r?\n/);
    const regExpressions = [];
    lines.filter(x => x.trim().length > 0).forEach(line => {
        if (line.startsWith('/')) {
            // This is already a regular expression, but we need to convert it out of raw
            // syntax described as a string into something we can construct a RegExp() with.
            const expression = convertStringToRegExp(line);
            if (expression !== null) {
                regExpressions.push(expression);
            }
        }
        else {
            // This is not a regular expression, turn it into a case insensitive word boundary search
            const expression = new RegExp(`\\b${line}\\b`, 'gi');
            regExpressions.push(expression);
        }
    });
    // Now apply these expressions to the text
    regExpressions.forEach(regExp => {
        rawQuery = rawQuery.replace(regExp, ' ');
    });
    // Final cleanup
    rawQuery = rawQuery.replace(/  +/g, ' '); // Make all double spaces single
    rawQuery = rawQuery.trim();
    return rawQuery;
}

function doSearchFromContextMenu(info, tab) {
    chrome.tabs.sendMessage(tab.id, 'contextMenuQuery', data => {
        doSearchOrConfigure(data.value);
    });
}

function doSearchFromToolbar() {
    chrome.tabs.sendMessage(activeTabId, 'selection', data => {
        doSearchOrConfigure(data.value);
    });
}

function doSearchOrConfigure(rawQuery) {
    if (!libraryName) {
        const opening = chrome.runtime.openOptionsPage();
        opening.then(onSuccess, onError);
        return;
    }
    const query = applyCustomReplacements(rawQuery);
    if (!query) {
        return;
    }
    doSearch(query);
}

function doSearch(query) {
    const safeLibraryName = libraryName.replace(' ', '_')
    const url = 'calibre://search/' + safeLibraryName + '?q=' + encodeURIComponent(query);

    const payload = {
        action: SEARCH_ACTION,
        search: url
    }
    const sending = chrome.runtime.sendNativeMessage(HOST_APPLICATION, payload);
    sending.then(function onResponse(response) {
		// Python script sends JSON that needs parsing. Golang exe sends an immediate JSON object.
		let json = response;
		if (typeof response == 'string') {
			json = JSON.parse(response);
		}
        if (json.status !== 'Success') {
            console.log('Error: Native application response: ' + response);
        }
    }, onError);
}

// Check to see if the current tab supports content scripts. If not, use the
// fallback mode where only selected text can be used.
function parseTabUrl(tabId) {
    let gettingTabId = chrome.tabs.get(tabId);
    gettingTabId.then((response) => {
        let tabProtocol = getUrlProtocol(response.url);
        let tabHostname = getUrlHostname(response.url);
        let tabFiletype = getUrlFiletype(response.url);

        // All new tabs start out as about:blank. By ignoring those, this code
        // isn't run unnecessarily, since onUpdated will use this function twice.
        if (response.url !== 'about:blank') {
            fallbackMode = false;

            if (ILLEGAL_CONTENTSCRIPT_PROTOCOLS.includes(tabProtocol)) {
                fallbackMode = true;
            }

            if (!tabHostname || ILLEGAL_CONTENTSCRIPT_DOMAINS.includes(tabHostname)) {
                fallbackMode = true;
            }

            if (ILLEGAL_FILETYPES.includes(tabFiletype)) {
                fallbackMode = true;
            }
        }
    });
}

// Extract the protocol part of a URL
function getUrlProtocol(url) {
    if (url.indexOf(':') > -1) {
        return url.split(':')[0];
    }
}

// Extract the hostname part of a URL
function getUrlHostname(url) {
    if (url.indexOf('://') > -1) {
        return url.split('/')[2];
    }
}

// Extract the file extension part of a URL This is a hack until
// bugzil.la/1457500 is fixed
// This is only used for PDFs as they are presented as ordinary html files
// loaded over http(s) but really aren't and thus content scripts aren't
// allowed, see also bugzil.la/1454760
function getUrlFiletype(url) {
    if (url.indexOf('/') > -1) {
        url = url.split('/').pop();
    }
    if (url.indexOf('?') > -1) {
        url = url.split('?')[0];
    }
    if (url.indexOf('.') > -1) {
        url = url.split('.').pop();
    }
    if (url.indexOf('#') > -1) {
        url = url.split('#')[0];
    }
    return url.toUpperCase();
}

// Set the 'contexts' parameter in chrome.contextMenus.create
// If in fallback mode, only selection is allowed,
// else, all applicable contexts are allowed.
function getAllowedContexts() {
    if (!fallbackMode) {
        return ['selection', 'link'];
    }
    else {
        return ['selection'];
    }
}

// Show a context menu option to do a search of configured library
function createSearchMenuLink() {
    chrome.contextMenus.create({
        id: MENU_ID,
        title: chrome.i18n.getMessage('menu_searchLabelInitial'),
        contexts: getAllowedContexts()
    }, () => chrome.runtime.lastError);

    chrome.contextMenus.onClicked.addListener((info, tab) => doSearchFromContextMenu(info, tab));
}

// Update our menu each time we get the library name
function updateContextMenu() {
    let displayText = chrome.i18n.getMessage('menu_configureText');
    if (libraryName) {
        displayText = chrome.i18n.getMessage('menu_searchLabelText', libraryName);
    } 
    chrome.contextMenus.update(MENU_ID, {
        title: displayText
    });
}

function main() {
    // The context menu will kickoff a search for the current text.
    createSearchMenuLink();
}

// Handle toolbar button clicks
chrome.action.onClicked.addListener(doSearchFromToolbar);

// Handle keyboard shortcut clicks
chrome.commands.onCommand.addListener((command) => {
    if (command === 'calibre-search') {
        doSearchFromToolbar();
    }
});

// When a tab is switched to, refresh our state/fallback mode
chrome.tabs.onActivated.addListener(function (info) {
    activeTabId = info.tabId;
    parseTabUrl(activeTabId);
    getOptions();
});

// When a browser window is switched to, refresh our state/fallback mode
// Handles situation where onActivated does not fire between different windows.
chrome.windows.onFocusChanged.addListener(function (windowId) {
    // -1 means focused a devtools debug window, just ignore it.
    if (windowId === -1) return;

    chrome.tabs.query({ currentWindow: true, active: true }, function (tabs) {
        activeTabId = tabs[0].id;
        parseTabUrl(activeTabId);
        getOptions();
    });
});

// When current active tab is being updated, refresh our state/fallback mode
chrome.tabs.onUpdated.addListener(function (tabId, changeInfo, tabInfo) {
    // Only run this code on the active tab.
    if (changeInfo.status === 'loading' && tabId === activeTabId) {
        parseTabUrl(tabId);
        getOptions();
    }
});

main();

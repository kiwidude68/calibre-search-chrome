let lastQuery = null;

function sanitize(query) {
    query = query.replace(/<(.|\n)*?>/g, ' '); // Remove persistent html tags
    query = query.replace(/\n\t/g, ' '); // Replace newlines and tabs with spaces
    query = query.replace(/  +/g, ' '); // Make all double spaces single
    query = query.trim();

    return query;
}

function captureQuery(info) {
    let query = '';
    const selection = window.getSelection().toString();
    const activeElem = document.activeElement;
    const elementType = activeElem.tagName;

    // This is text selection
    if (selection) {
        query = sanitize(selection);
    }

    // This is input text selection link text
    if (!query && (elementType === 'TEXTAREA' || elementType === 'INPUT')) {
        query = sanitize(activeElem.value.substring(activeElem.selectionStart, activeElem.selectionEnd))
    }

    // This is link text
    if (!query && info != null && elementType === 'A') {
        let clickedElem = info.target;
        let returnText = clickedElem.textContent;
        let removeElement = clickedElem.getElementsByTagName('SCRIPT');

        for (i = 0; i < removeElement.length; i++) {
            returnText = returnText.replace(removeElement[i].textContent, '');
        }
        query = sanitize(returnText);
    }

    lastQuery = query;
}

// Where using the keyboard shortcut/toolbar button we can only work
// with the selected text on the page, no anchor links.
function getSelectionText() {
    let text = '';
    const activeEl = document.activeElement;
    const activeElTagName = activeEl ? activeEl.tagName.toLowerCase() : null;
    if ((activeElTagName === 'textarea') || 
        (activeElTagName === 'input' && /^(?:text|search|url)$/i.test(activeEl.type)) &&
        (typeof activeEl.selectionStart === 'number')) {
        text = activeEl.value.slice(activeEl.selectionStart, activeEl.selectionEnd);
    } else if (window.getSelection) {
        text = window.getSelection().toString();
    }
    return sanitize(text);
}

document.addEventListener('contextmenu', captureQuery);

chrome.runtime.onMessage.addListener(function(request, sender, sendResponse) {
    if (request === 'contextMenuQuery') {
        sendResponse({ value: lastQuery });
    } else if (request === 'selection') {
        sendResponse({ value: getSelectionText() });
    }
});
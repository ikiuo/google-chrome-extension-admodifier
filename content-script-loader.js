"use strict";

(async() => await import(await chrome.runtime.getURL('content-script.js')))();

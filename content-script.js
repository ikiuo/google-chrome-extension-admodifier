"use strict";

import { safeURL, DomainTree } from './utility.js';

// -----------------------------------------------------------------------------

class ContentScript {

	#sendMessage(type, data, id) {
		return chrome.runtime.sendMessage(
			((id != null) ? id : chrome.runtime.id),
			{ type: type, data: data });
	}
	#getExtension(name) {
		return this.#sendMessage('get', name);
	}
	#setExtension(name, data) {
		return this.#sendMessage('set', {name: name, value: data});
	}
	#getLoaded() {
		return this.#sendMessage('getLoaded');
	}
	#getDomains() {
		return this.#sendMessage('getDomains');
	}
	#getSelector() {
		return this.#sendMessage('getSelector');
	}
	#getTarget(url) {
		return this.#sendMessage('getTarget', url);
	}

	/*
	 *
	 */

	#startService = false;
	#blockDomains;
	#globalSelector;

	#target = false;
	#targetList;

	#idleDelay = 1000;
	#intervalTime = 1000;
	#intervalHandle;
	#intervalCount = 0;
	#intervalCountMax = -1;

	#fixTagSet = new Set([
		'A',
		'ARTICLE',
		'ASIDE',
		'DIV',
		'FOOTER',
		'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
		'HEADER',
		'LI',
		'MAIN',
		'UL',
		'SECTION',
		'SPAN',
	]);

	#fixTagSkip = new Set([
		'SCRIPT',
		'STYLE',
	]);

	#createDummyHTML() {
		return [
			'<div style="text-align:center; color: #00000000;>',
			'<small>この広告は削除されました</small>',
			'</div>'
		].join('');
	}

	#isBlockDomain(host) {
		return this.#blockDomains.check(host);
	}

	#fixTag(tagSet, tag, hidden) {
		const parent = tag.parentElement;

		if (!hidden) {
			tag.remove();
		} else {
			tag.style.minWidth = '0px';
			tag.style.minHeight = '0px';
			tag.style.width = '0px';
			tag.style.height = '0px';
			tag.style.border = '0px';
			tag.style.margin = '0px';
			tag.style.padding = '0px';
			tag.style.display = 'none';
			if (tag.hidden)
				return;
			tag.hidden = true;
		}

		if (!parent || !parent.nodeName || !parent.childNodes ||
			!this.#fixTagSet.has(parent.nodeName))
			return;

		let reference = null;
		if (hidden) {
			let index = -1;
			for (let n in parent.childNodes)
				if (tag === parent.childNodes[n]) {
					if ((index + 1) < parent.childNodes.length)
						reference = parent.childNodes[index + 1];
					break;
				}
			tagSet.push(tag);
		}

		let empty = true;
		for (const child of parent.childNodes) {
			if (this.#fixTagSkip.has(child.nodeName) ||
				child.nodeName == '#comment' ||
				tagSet.find((t) => t == child))
				continue;
			if (child.nodeName == '#text' &&
				child.nodeValue.trim().length == 0)
				continue;
			empty = false;
			break;
		}
		if (empty)
			this.#fixTag(tagSet, parent, hidden);
	}

	#clearHTML() {
		this.#target = true;
		if (document.head)
			document.head.innerHTML = '';
		if (document.body)
			document.body.innerHTML = this.#createDummyHTML();
	}

	#updating = false;
	#checkPage() {
		const updating = this.#updating;
		this.#updating = true;
		if (!updating) {

			if (this.#target) {
				this.#clearHTML();
			} else {
				for (const data of this.#targetList)
					this.#checkHTML(data);
			}

			this.#updating = false;
		}
	}

	#checkHTML(targetData) {
		const log = false;

		if (!targetData.enable)
			return;

		const tagSet = [];
		const fixTag = ((tag) =>
			this.#fixTag(tagSet, tag, targetData.hidden));

		let selector = this.#globalSelector;
		if (selector == null)
			return;

		if (targetData.query && targetData.query.length > 0)
			selector += ', ' + targetData.query.join(', ');
		for (const tag of document.querySelectorAll(selector))
			fixTag(tag);

		if (targetData.tagid)
			for (const tag of document.querySelectorAll('[id]')) {
				const tagid = tag.getAttribute('id');
				for (const re of targetData.tagid)
					if (tagid.match(re) != null)
						fixTag(tag);
			}

		const query = 'a[href], iframe[src], img[src], script[src]';
		for (const tag of document.querySelectorAll(query)) {
			let url;

			switch (tag.tagName) {
			case 'A':
				url = tag.href;
				break;
			case 'IFRAME':
			case 'IMG':
			case 'SCRIPT':
				url = tag.src;
				break;
			}
			if (!url)
				continue;

			const urlp = safeURL(url);
			const block = this.#isBlockDomain(urlp.host);
			if (block)
				fixTag(tag);
		}

		if (targetData.insert && !targetData.done) {
			targetData.done = true;
			for (const check of targetData.insert) {
				if (!check.query || !check.position)
					continue;
				for (const element of document.querySelectorAll(check.query)) {
					const tag = document.createElement('div');
					tag.style.border = '0px';
					tag.style.margin = '0px';
					tag.style.padding = '0px';
					if (check.width) {
						tag.style.minWidth = check.width;
						tag.style.width = check.width;
					}
					if (check.height) {
						tag.style.minHeight = check.height;
						tag.style.width = check.width;
					}
					element.insertAdjacentElement(
						check.position ?? 'beforeend', tag);
				}
			}
		}
	}

	#onInterval() {
		this.#checkPage();
		if (++this.#intervalCount == this.#intervalCountMax)
			this.#stopInterval();
	}
	#startInterval() {
		this.#intervalCount = 0;
		if (this.#intervalHandle == null)
			this.#intervalHandle = setInterval(
				() => this.#onInterval(), this.#intervalTime);
	}
	#stopInterval() {
		const handle = this.#intervalHandle;
		this.#intervalHandle = null;
		if (handle != null)
			clearInterval(handle);
	}

	#onIdle(deadline) {
		this.#checkPage();
		this.#startInterval();
	}

	#onMutate(mutations, observer) {
		this.#checkPage();
		this.#startInterval();
	}

	async #onScriptStart() {
		if (this.#startService)
			return;
		if (!await this.#getLoaded()) {
			setTimeout(async() => await this.#onScriptStart(), 100);
			return;
		}
		this.#startService = true;
		this.#blockDomains = new DomainTree(await this.#getDomains());
		this.#globalSelector = await this.#getSelector();

		const url = document.baseURI;
		const urlp = safeURL(url);
		{
			const target = await this.#getTarget(url) ?? [];
			this.#targetList = (target.length > 0) ? target : [{enable: true}];
		}

		if (this.#isBlockDomain(urlp.host))
			this.#clearHTML();
		else if (document.body)
			new MutationObserver(
				(l, o) => this.#onMutate(l, o))
			.observe(document.body, {
				subtree: true,
				childList: true,
			});
		window.requestIdleCallback(
			(deadline) => this.#onIdle(deadline),
			{timeout: this.#idleDelay});
	}

	constructor() {
		this.#onScriptStart();
	}
}

// -----------------------------------------------------------------------------

const content_script = new ContentScript();

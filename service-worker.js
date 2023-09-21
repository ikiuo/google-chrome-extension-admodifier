"use strict";

import { safeURL, DomainTree } from './utility.js';

// -----------------------------------------------------------------------------

class ServiceWorker {
	#textDecoder = new TextDecoder();

	/*
	 *
	 */

	#dictionary = new Map();
	#message(request, sender, respose) {
		let res = null;
		if (respose != null && request.type != null) {
			const dictionary = this.#dictionary;
			switch (request.type) {
			case 'get':
				if (typeof(request.name) == 'string')
					res = dictionary.get(request.data);
				break;
			case 'set':
				if (typeof(request.name) == 'string')
					dictionary.set(request.data.name, request.data.value);
				break;

			case 'getLoaded':
				res = this.#loaded;
				break;
			case 'getDomains':
				res = this.#loaded ? this.#currentDynamicDomains : null;
				break;
			case 'getSelector':
				res = this.#loaded ? this.#currentDynamicSelector : null;
				break;
			case 'getTarget':
				res = this.#loaded ? this.#getTargetData(request.data) : null;
				break;

			default:
				console.log('unknown:', request, sender, respose);
				break;
			}
		}
		respose(res);
	}

	/*
	 *
	 */

	#commentFilter(table) {
		return table.map((s) => s.trim()).filter((s) => s.length && s[0] != '#');
	}

	async #readFile(path) {
		try {
			return (await (fetch(chrome.runtime.getURL(`data/${path}`))
						   .then((res) => res.body.getReader().read()))).value;
		} catch (e) {
			console.error(`fetch failed: ${path}`, e);
			return null;
		}
	}

	async #readTextFile(path) {
		return this.#textDecoder.decode((await this.#readFile(path)) ?? []);
	}

	async #readLines(path) {
		const text = await this.#readTextFile(path);
		return text == null ? [] : text.split('\n');
	}

	async #readJSONFile(path) {
		try {
			const text = await this.#readTextFile(path);
			return text == null ? text : JSON.parse(text);
		} catch (e) {
			console.error(`JSON.parse failed: ${path}`, e)
			return null;
		}
	}


	/*
	 *
	 */

	#currentDynamicDomains;
	#currentDynamicRules;
	#currentDynamicSelector;
	#newDynamicDomains;
	#newDynamicRules;
	#newDynamicSelector;
	#lastRuleId = 1;

	#appendBlockCondition(condition) {
		this.#newDynamicRules.push({
			"id": ++this.#lastRuleId,
			"action": {"type": "block"},
			"condition": condition,
		});
	}

	#appendBlockDomain(path, table) {
		if (table == null)
			return;
		try {
			for (const name of table) {
				this.#newDynamicDomains.add(name);
				this.#appendBlockCondition({"urlFilter": `||${name}`});
			}
		} catch (e) {
			console.error(`appendBlockDomain failed: ${path}`, e);
		}
	}

	#appendBlockUrl(path, table) {
		if (table == null)
			return;
		try {
			for (const url of table)
				this.#appendBlockCondition({"urlFilter": `${url}`});
		} catch (e) {
			console.error(`appendBlockUrl failed: ${path}`, e);
		}
	}

	#appendBlockRegex(path, table) {
		if (table == null)
			return;
		try {
			for (const regex of table)
				this.#appendBlockCondition({"regexFilter": `${regex}`});
		} catch (e) {
			console.error(`appendBlockRegex failed: ${path}`, e);
		}
	}

	/*
	 *
	 */

	#appendContentQuery(path, queries) {
		if (queries != null)
			for (const query of queries)
				if (query && query.length > 0)
					this.#newDynamicSelector.add(query);
	}

	/*
	 *
	 */

	#currentTargetDomainTree;
	#currentTargetDomainData;
	#currentTargetHost;
	#currentTargetUrl;
	#newTargetDomainTree;
	#newTargetDomainData;
	#newTargetHost;
	#newTargetUrl;
	#lastTargetId;

	#getTargetData(url) {
		const urlp = safeURL(url);
		const host = urlp.host;
		const target = new Map();

		const chkdt = this.#currentTargetDomainTree.scan(host);
		if (chkdt != null) {
			const ddg = this.#currentTargetDomainData.get(chkdt.domain);
			for (const hostp of ddg ?? [])
				target.set(hostp.id, hostp.data);
		}
		for (const hostp of this.#currentTargetHost) {
			if (host.match(hostp.regex) != null)
				target.set(hostp.id, hostp.data);
		}
		for (const hostp of this.#currentTargetUrl) {
			if (host.match(hostp.regex) != null)
				target.set(hostp.id, hostp.data);
		}

		const list = [];
		for (const data of target.values()) {
			if (!Object.hasOwn(data, 'enable')) data.enable = true;
			if (!Object.hasOwn(data, 'hidden')) data.hidden = false;
			list.push(data);
		}
		return list;
	}

	#appendTargetDomain(path, table, data) {
		if (table == null)
			return;
		try {
			for (const domain of table) {
				this.#newTargetDomainTree.add(domain);

				if (!this.#newTargetDomainData.has(domain))
					this.#newTargetDomainData.set(domain, []);
				this.#newTargetDomainData.get(domain).push({
					id: ++this.#lastTargetId,
					data: data,
				});
			}
		} catch (e) {
			console.error(`appendTargetDomain failed: ${path}`, e);
		}
	}

	#appendTargetHosts(path, table, data) {
		if (table == null)
			return;
		try {
			for (const hosts of table) {
				if (hosts.length < 2)
					continue;
				const s = `(${hosts.slice(1).join('|')}).${hosts[0]}`;
				this.#newTargetHost.push({
					regex: new RegExp(`^${s.replaceAll('.', '\\.')}\$`),
					id: ++this.#lastTargetId,
					data: data,
				});
			}
		} catch (e) {
			console.error(`appendTargetHosts failed: ${path}`, e);
		}
	}

	#appendTargetHost(path, table, data) {
		if (table == null)
			return;
		try {
			for (const host of table)
				this.#newTargetHost.push({
					regex: new RegExp(`^(www\\.)?${host.replaceAll('.', '\\.')}\$`),
					id: ++this.#lastTargetId,
					data: data,
				});
		} catch (e) {
			console.error(`appendTargetHost failed: ${path}`, e);
		}
	}

	#appendTargetUrl(path, table, data) {
		if (table == null)
			return;
		try {
			for (const regex of table)
				this.#newTargetUrl.push({
					regex: new RegExp(regex),
					id: ++this.#lastTargetId,
					data: data,
				});
		} catch (e) {
			console.error(`appendTargetUrl failed: ${path}`, e);
		}
	}

	/*
	 *
	 */

	async #initializeTable() {
		this.#newDynamicDomains = new Set();
		this.#newDynamicSelector = new Set();
		this.#newDynamicRules = [];

		this.#newTargetDomainTree = new DomainTree();
		this.#newTargetDomainData = new Map();
		this.#newTargetHost = [];
		this.#newTargetUrl = [];
		this.#lastTargetId = 0;

		if (this.#currentDynamicRules != null)
			return;

		// this.#currentDynamicDomains = [];
		this.#currentDynamicRules = [];
		// this.#currentDynamicSelector = '';
		// this.#lastRuleId = 1;

		// this.#currentTargetDomainTree = new DomainTree();
		// this.#currentTargetDomainData = new Map();
		// this.#currentTargetHost = [];
		// this.#currentTargetUrl = [];

		const rules = await chrome.declarativeNetRequest.getDynamicRules();
		await chrome.declarativeNetRequest.updateDynamicRules({
			removeRuleIds: rules.map((r) => r.id),
		});
	}

	async #updateTable() {
		try {
			await chrome.declarativeNetRequest.updateDynamicRules({
				removeRuleIds: this.#currentDynamicRules.map((r) => r.id),
				addRules: this.#newDynamicRules,
			});
			this.#currentDynamicDomains = [...this.#newDynamicDomains];
			this.#currentDynamicRules = this.#newDynamicRules;
			this.#currentDynamicSelector = [...this.#newDynamicSelector].join(', ');

			this.#currentTargetDomainTree = this.#newTargetDomainTree;
			this.#currentTargetDomainData = this.#newTargetDomainData;
			this.#currentTargetHost = this.#newTargetHost;
			this.#currentTargetUrl = this.#newTargetUrl;

			this.#newDynamicDomains = null;
			this.#newDynamicRules = null;
			this.#newDynamicSelector = null;

			this.#newTargetDomainTree = null;
			this.#newTargetDomainData = null;
			this.#newTargetHost = null;
			this.#newTargetUrl = null;
		} catch (e) {
			console.error(e);
		}
	}

	async #loadSource() {
		const table = await this.#readLines('source/index.txt');
		for (const path of this.#commentFilter(table)) {
			const file = `source/${path}`;
			const source = await this.#readJSONFile(file);
			if (source != null) {
				this.#appendBlockDomain(file, source.domain);
				this.#appendBlockUrl(file, source.urlFiler);
				this.#appendBlockRegex(file, source.regexFilter);
				this.#appendContentQuery(file, source.query);
			}
		}
	}

	async #loadTarget() {
		const table = await this.#readLines('target/index.txt');
		for (const path of this.#commentFilter(table)) {
			const file = `target/${path}`;
			const target = await this.#readJSONFile(file);
			if (target != null) {
				this.#appendTargetDomain(file, target.domain, target);
				this.#appendTargetHosts(file, target.hosts, target);
				this.#appendTargetHost(file, target.host, target);
				this.#appendTargetUrl(file, target.url, target);
			}
		}
	}

	/*
	 *
	 */

	#loading = false;
	#loaded = false;
	async #loadTable() {
		const loading = this.#loading;
		this.#loading = true;
		if (loading)
			return;

		await this.#initializeTable();
		await this.#loadSource();
		await this.#loadTarget();
		await this.#updateTable();

		this.#loading = false;
		this.#loaded = true;
	}

	/*
	 *
	 */

	constructor() {
		this.#loadTable();

		chrome.runtime.onMessage.addListener(
			((request, sender, respose) =>
				this.#message(request, sender, respose)));
	}
}

// -----------------------------------------------------------------------------

const servie_worker = new ServiceWorker();

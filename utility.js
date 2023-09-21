"use strict";

export function safeURL(url) {
	try {
		return new URL(url);
	} catch (error) {
		return new URL('null://');
	}
}

export class DomainTree {
	#set;
	#root;

	constructor() {
		this.#root = {};
		this.#set = new Set();

		for (let n = 0; n < arguments.length; n++)
			(arguments[n] ?? []).forEach((host) => this.add(host));
	}

	add(domain) {
		if (domain == null)
			return;
		this.#set.add(domain);
		const path = domain.split('.');
		let name, node = this.#root;
		while ((name = path.pop()) != null) {
			let child = node[name];
			if (child == null)
				node[name] = child = {};
			node = child;
		}
	}

	scan(host) {
		const path = host.split('.');
		let node = this.#root;
		let name, sep = '', domain = '';
		while ((name = path.pop()) != null) {
			if ((node = node[name]) == null)
				break;
			domain = `${name}${sep}${domain}`;
			sep = '.';
		}
		return {
			domain: domain,
			sub: host.slice(0, host.length - domain.length),
		}
	}

	check(host) {
		const chk = this.scan(host);
		return (this.#set.has(chk.domain) ? chk : null);
	}
}

#!/usr/bin/env node
import os from 'os';
import { promises as fs } from 'fs';
import { Transform } from 'stream';
import { pathToFileURL } from 'url';
import { ArgumentParser } from 'argparse';
import httpProxy from 'http-proxy';
import Koa from 'koa';
import koaConditionalGet from 'koa-conditional-get';
import jsBeautify from 'js-beautify';
import JSZip from 'jszip';
import fetch from 'node-fetch';

// Parse program arguments
const argv = function() {
	const parser = new ArgumentParser;
	parser.add_argument('--beautify', {
		action: 'store_true',
		default: false,
	});
	parser.add_argument('--package', {
		nargs: '?',
		type: 'str',
	});
	parser.add_argument('--port', {
		nargs: '?',
		type: 'int',
	});
	return parser.parse_args();
}();

const beautify = argv.beautify;

// Create proxy
const proxy = httpProxy.createProxyServer({
	changeOrigin: true,
});
proxy.on('error', err => console.error(err));

// Locate and read `package.nw`
const [ data, stat ] = await async function() {
	const path = argv.package ?? function() {
		switch (process.platform) {
			case 'darwin': return new URL('./Library/Application Support/Steam/steamapps/common/Screeps/package.nw', `${pathToFileURL(os.homedir())}/`);
			case 'win32': return 'C:\\Program Files (x86)\\Steam\\steamapps\\common\\Screeps\\package.nw';
			default: return undefined;
		}
	}();
	if (!path) {
		console.log('Could not find `package.nw`. Please check `--package` argument');
		process.exit(1);
	}
	return Promise.all([ fs.readFile(path), fs.stat(path) ]);
}();

// Read package zip metadata
const zip = new JSZip;
await zip.loadAsync(data);
const { files } = zip;

// HTTP header is only accurate to the minute
const lastModified = Math.floor(+stat.mtime / 60000) * 60000;

// Set up koa server
const koa = new Koa;
const port = argv.port ?? 8080;
const host = 'localhost';
const server = koa.listen(port, host);
server.on('error', err => console.error(err));
const extract = (url: string) =>
	/^\/\((?<backend>[^)]+)\)(?<endpoint>\/.*)$/.exec(url)?.groups;

// Serve client assets directly from steam package
koa.use(koaConditionalGet());
koa.use(async(context, next) => {
	const info = extract(context.path);
	if (!info) {
		console.log('Unknown URL', context.path, info);
		return;
	}
	const path = info.endpoint === '/' ?
		'index.html' : info.endpoint.substr(1);
	const file = files[path];
	// eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
	if (!file) {
		return next();
	}

	// Check cached response based on zip file modification
	context.set('Last-Modified', `${new Date(lastModified)}`);
	if (context.fresh) {
		return;
	}

	// Rewrite various payloads
	context.body = await async function() {
		if (path === 'index.html') {
			let body = await file.async('text');
			// Inject startup shim
			const header = '<title>Screeps</title>';
			body = body.replace(header, `<script>
if (localStorage.backendDomain && localStorage.backendDomain !== ${JSON.stringify(info.backend)}) {
	Object.keys(localStorage, key => delete localStorage[key]);
}
localStorage.backendDomain = ${JSON.stringify(info.backend)};
if (
	(localStorage.auth === 'null' && localStorage.prevAuth === 'null') ||
	!(Date.now() - localStorage.lastToken < 2 * 60000) ||
	(localStorage.prevAuth !== '"guest"' && (localStorage.auth === 'null' || !localStorage.auth))
) {
	localStorage.auth = '"guest"';
}
localStorage.tutorialVisited = 'true';
localStorage.placeSpawnTutorialAsked = '1';
localStorage.prevAuth = localStorage.auth;
localStorage.lastToken = Date.now();
(function() {
	let auth = localStorage.auth;
	setInterval(() => {
		if (auth !== localStorage.auth) {
			auth = localStorage.auth;
			localStorage.lastToken = Date.now();
		}
	}, 1000);
})();
// The client will just fill this up with data until the application breaks.
if (localStorage['users.code.activeWorld']?.length > 1024 * 1024) {
	try {
		const code = JSON.parse(localStorage['users.code.activeWorld']);
		localStorage['users.code.activeWorld'] = JSON.stringify(code.sort((left, right) => right.timestamp - left.timestamp).slice(0, 2))
	} catch (err) {
		delete localStorage['users.code.activeWorld']
	}
}
addEventListener('beforeunload', () => {
	if (localStorage.auth === 'null') {
		document.cookie = 'id=';
		document.cookie = 'session=';
	}
});
			</script>` + header);
			// Remove tracking pixels
			body = body.replace(/<script[^>]*>[^>]*xsolla[^>]*<\/script>/g, '<script>xnt = new Proxy(() => xnt, { get: () => xnt })</script>');
			body = body.replace(/<script[^>]*>[^>]*facebook[^>]*<\/script>/g, '<script>fbq = new Proxy(() => fbq, { get: () => fbq })</script>');
			body = body.replace(/<script[^>]*>[^>]*google[^>]*<\/script>/g, '<script>ga = new Proxy(() => ga, { get: () => ga })</script>');
			body = body.replace(/<script[^>]*>[^>]*mxpnl[^>]*<\/script>/g, '<script>mixpanel = new Proxy(() => mixpanel, { get: () => mixpanel })</script>');
			body = body.replace(/<script[^>]*>[^>]*twttr[^>]*<\/script>/g, '<script>twttr = new Proxy(() => twttr, { get: () => twttr })</script>');
			body = body.replace(/<script[^>]*>[^>]*onRecaptchaLoad[^>]*<\/script>/g, '<script>function onRecaptchaLoad(){}</script>');
			return body;
		} else if (path === 'config.js') {
			// Screeps server config
			return `
				var HISTORY_URL = undefined;
				var API_URL = '/(${info.backend})/api/';
				var WEBSOCKET_URL = '/(${info.backend})/socket/';
				var CONFIG = {
					API_URL: API_URL,
					HISTORY_URL: HISTORY_URL,
					WEBSOCKET_URL: WEBSOCKET_URL,
					PREFIX: '',
					IS_PTR: false,
					DEBUG: false,
					XSOLLA_SANDBOX: false,
				};
			`;
		} else if (context.path.endsWith('.js')) {
			let text = await file.async('text');
			if (path === 'build.min.js') {
				// Load backend info from underlying server
				const version = await async function() {
					try {
						const response = await fetch(`${info.backend}/api/version`);
						return JSON.parse(await response.text());
					} catch (err) {}
				}();

				// Look for server options payload in build information
				for (const match of text.matchAll(/\boptions=\{/g)) {
					for (let ii = match.index!; ii < text.length; ++ii) {
						if (text.charAt(ii) === '}') {
							try {
								const payload = text.substring(match.index!, ii + 1);
								// eslint-disable-next-line @typescript-eslint/no-unused-vars
								const holder =
								// eslint-disable-next-line @typescript-eslint/no-implied-eval
								new Function(payload);
								if (payload.includes('apiUrl')) {
									// Inject `host`, `port`, and `official`
									const backend = new URL(info.backend);
									text = `${text.substr(0, ii)},
										host: ${JSON.stringify(backend.hostname)},
										port: ${backend.port || '80'},
										official: ${Boolean(version?.serverData?.shards)},
									} ${text.substr(ii + 1)}`;
								}
								break;
							} catch (err) {}
						}
					}
				}
				if (new URL(info.backend).hostname !== 'screeps.com') {
					// Replace official CDN with local assets
					text = text.replace(/https:\/\/d3os7yery2usni\.cloudfront\.net\//g, `${info.backend}/assets/`);
				}
			}
			return beautify ? jsBeautify(text) : text;

		} else {
			// JSZip doesn't implement their read stream correctly and it causes EPIPE crashes. Pass it
			// through a no-op transform stream first to iron that out.
			const stream = new Transform;
			stream._transform = function(chunk, encoding, done) {
				this.push(chunk, encoding);
				done();
			};
			file.nodeStream().pipe(stream);
			return stream;
		}
	}();

	// Set content type
	context.set('Content-Type', {
		'.css': 'text/css',
		'.html': 'text/html',
		'.js': 'text/javascript',
		'.map': 'application/json',
		'.png': 'image/png',
		'.svg': 'image/svg+xml',
		'.ttf': 'font/ttf',
		'.woff': 'font/woff',
		'.woff2': 'font/woff2',
	}[/\.[^.]+$/.exec(path.toLowerCase())?.[0] ?? '.html']!);

	// We can safely cache explicitly-versioned resources forever
	if (context.request.query.bust) {
		context.set('Cache-Control', 'public,max-age=31536000,immutable');
	}
});

// Proxy API requests to Screeps server
koa.use(async(context, next) => {
	if (context.header.upgrade) {
		context.respond = false;
	} else {
		const info = extract(context.url);
		if (info) {
			context.respond = false;
			context.req.url = info.endpoint;
			proxy.web(context.req, context.res, {
				forward: info.backend,
				target: info.backend,
			});
			return;
		}
		return next();
	}
});

// Proxy WebSocket requests
server.on('upgrade', (req, socket, head) => {
	const info = extract(req.url!);
	if (info && req.headers.upgrade?.toLowerCase() === 'websocket') {
		req.url = info.endpoint;
		proxy.ws(req, socket, head, {
			forward: info.backend,
			target: info.backend,
		});
		socket.on('error', err => console.error(err));
	} else {
		socket.end();
	}
});

console.log(`🌎 Listening -- http://${host}:${port}/(https://screeps.com)/`);

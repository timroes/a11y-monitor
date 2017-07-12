// Very quick and dirty script to scan URLs via pa11y.
const pa11y = require('pa11y');
const elasticsearch = require('elasticsearch');

const pa11yOptions = {
};

const test = pa11y();

const timestamp = Date.now();
const defaultPath = '/';
const codeRegex = /Principle(\d+).*Guideline([0-9_]+)\.([0-9_]+)/;

if (!process.env.ES_HOST) {
	console.error("Specify an ES host via env var ES_HOST.");
	return;
}

const client = new elasticsearch.Client({
	host: process.env.ES_HOST
});

function incrementRunCount(doc) {
	return client.update({
		index: 'urls',
		type: 'url',
		id: doc._id,
		body: {
			doc: {
				scans: (doc._source.scans || 0) + 1
			}
		}
	});
}

function testUrl(schema, hostname, path) {
	return new Promise((resolve, reject) => {
		const url = `${schema}://${hostname}${path}`;
		console.log(`Crawl URL ${url}`);
		test.run(url, (error, results) => {
			if (error) {
				console.error(error);
				return reject(error);
			}
			const body = results.reduce((prev, curr) => {
				const [_, principle, guideline, rule] = codeRegex.exec(curr.code);
				return [...prev,
					{ index: { _index: 'tests', _type: 'pa11y' }},
					Object.assign({}, curr, { timestamp, hostname, path, principle, guideline, rule })
				];
			}, []);

			client.bulk({
				body: body
			}).then(() => {
				console.log(`Stored results for ${url} in ES.`);
			}).then(resolve, reject);
		});
	});
}

client.indices.putMapping({
	index: 'tests',
	type: 'pa11y',
	body: {
		pa11y: {
			properties: {
				timestamp: {
					type: 'date'
				}
			}
		}
	}
}).then(() => {
	console.log('Put mapping to ES!');
	return client.search({
		 index: 'urls',
	 });
}).then(result => {
	return Promise.all(result.hits.hits.map(doc =>
		testUrl(doc._source.schema, doc._source.host, doc._source.path || defaultPath)
		.then(() => incrementRunCount(doc))
	));
}).then(() => {
	console.log('Finished scanning all URLs.');
});

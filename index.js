const puppeteer = require('puppeteer');
const chrono = require('chrono-node');
const { InfluxDB } = require('@influxdata/influxdb-client')
require('dotenv').config()
console.log(`CONTACT_TARGET=${process.env.CONTACT_TARGET}`);
console.log(`INFLUXDB_TOKEN=${process.env.INFLUXDB_TOKEN}`);
console.log(`INFLUXDB_ORG=${process.env.INFLUXDB_ORG}`);
console.log(`INFLUXDB_BUCKET=${process.env.INFLUXDB_BUCKET}`);
console.log(`ISDOCKER=${process.env.ISDOCKER}`);

// The contact name to track (mind the case).
const contactTarget = process.env.CONTACT_TARGET;

let docker = process.env.ISDOCKER === 'TRUE';
let influxUrl = docker ? `http://influxdb:9999` : 'http://localhost:9999';
let userDataDir = docker ? `/usr/data/userdata` : 'data/userdata';
let args = docker ? ['--no-sandbox', '--disable-setuid-sandbox'] : [];
let screenshotPath = docker ? '/usr/data/screenshots/screenshot.png' : 'data/screenshots/screenshot.png';

let client = new InfluxDB({ url: influxUrl, token: process.env.INFLUXDB_TOKEN });
const writeApi = client.getWriteApi(process.env.INFLUXDB_ORG, process.env.INFLUXDB_BUCKET);

(async () => {
    const browser = await puppeteer.launch({
        args: args,
        headless: true,
        userDataDir: userDataDir // Persist the session.
    });

    const page = await browser.newPage();
    page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:75.0) Gecko/20100101 Firefox/75.0');

    await page.goto('https://web.whatsapp.com/');
    await page.waitFor(10000);

    await page.screenshot({ path: screenshotPath });

    console.log('Awaiting/Checking peering with WhatsApp phone');
    await page.waitFor('#side', { timeout: 120000 }).then(() => { // Scan the QR code within the next 2 minutes.
        console.log('Connected !');
    }).catch((res) => {
        console.log('Not connected !', res);
        return -1;
    })
    await page.waitFor(1000);

    await page.focus('._2S1VP'); // Focus search input form.
    await page.keyboard.type(contactTarget, { delay: 100 });
    await page.waitFor(6000);

    let contactElt = (await page.$x(`//*[@class="_25Ooe" and . = "${contactTarget}"]`))[0]; // Select the best result.
    contactElt.click();

    while (true) {
        await page.waitFor(5000);

        let statusElt = await page.$('.O90ur');

        let statusAvailable = (statusElt) ? 1 : 0;
        let scan = `status,contactName=${contactTarget} statusAvailable=${statusAvailable}u`;
        writeApi.writeRecord(scan);

        if (!statusElt) {
            console.log(`No status available for ${contactTarget}.`);
            continue;
        }
        let status = await statusElt.evaluate(x => x.textContent);  // `last seen today at 13:15` format.
        console.log(`Status for ${contactTarget} is '${status}'.`);

        if (status == "click here for contact info") {
            console.log(`'click here for contact info' case for ${contactTarget}.`);
            continue;
        }

        let lastSeenDate = chrono.parseDate(status);
        console.log(`Last seen date parsed: ${lastSeenDate}`);

        let offlineSince = (lastSeenDate === null) ? 0 : ((new Date().getTime() - lastSeenDate.getTime()) / 1000).toFixed(0);
        if (offlineSince < 0)
            offlineSince = 0;

        let data = `status,contactName=${contactTarget} offlineSince=${offlineSince}u`;
        writeApi.writeRecord(data);
    }

    await browser.close();
})();

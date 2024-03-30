import dotenv from 'dotenv';
import * as firebase from 'firebase/app';
import { getDatabase, ref, set } from 'firebase/database';
import fs from 'fs';
import puppeteer, { Browser, Page } from 'puppeteer';

dotenv.config();

class Database {

    constructor() {
        firebase.initializeApp(JSON.parse(process.env.FIREBASE_CONFIG!));
    }

    async set(path: string, data: any) {
        const db = getDatabase();
        await set(ref(db, path), data);
    }


}

class A2A {
    private _page?: Page;
    private browser?: Browser;
    private database: Database = new Database();


    private headless: boolean = true;
    private isDebugActive: boolean = false;

    constructor({
        headless,
        debug,
    }: {
        headless?: boolean;
        debug?: boolean;
    }) {
        if (fs.existsSync('./error.png')) fs.unlinkSync('./error.png');

        if (typeof headless !== "undefined") this.headless = headless;
        if (typeof debug !== "undefined") this.isDebugActive = debug;
    }


    get page() {
        if (!this._page) throw new Error('Page not initialized');
        return this._page;
    }

    private async setup() {
        this.debug('Setting up browser');
        const browser = await puppeteer.launch({
            args: ['--no-sandbox'],
            executablePath: process.env.PUPPETEER_EXEC_PATH,
            headless: this.headless,
            devtools: !this.headless,
        });
        this.browser = browser;
        this._page = await browser.newPage();
        // open devtools

        await this.page.setViewport({ width: 1280, height: 720 });
        await this.page.setExtraHTTPHeaders({
            'user-agent': 'Mozilla/5.0 (Windows NT 10.0; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.0.0 Safari/537.36',
            'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
            'accept-encoding': 'gzip, deflate, br',
            'accept-language': 'en-US,en;q=0.9,en;q=0.8'
        });
        this.debug('Browser setup complete');

    }

    private async teardown() {
        this.debug('Tearing down browser');
        if (this.browser) await this.browser.close();
        this.debug('Browser torn down');
    }

    private debug(string: string) {
        if (!this.isDebugActive) return;
        console.debug("  DEBUG: " + string);
    }

    async run() {
        this.debug('Running script');
        try {
            await this.setup();
            await this.login();
            const gas = await this.getGas();
            console.log(`Media mensile gas: ${gas.toFixed(2)} €`);
            this.database.set('a2a/gas', gas.toString().replace('.', ','));
            const electricity = await this.getElectricity();
            this.database.set('a2a/electricity', electricity.toString().replace('.', ','));
            console.log(`Media mensile elettricità: ${electricity.toFixed(2)} €`);

            console.log(`Media mensile: ${((gas + electricity).toFixed(2))} €`);

        } catch (e) {
            await this.page.screenshot({ path: './error.png' });
            console.error(e);
            throw e;
        } finally {
            await this.teardown();
        }
    }

    private async login() {
        this.debug('Logging in');
        await this.page.goto('https://login.a2a.it/');
        await this.page.type('#username', process.env.A2A_USERNAME!);
        await this.page.type('#password', process.env.A2A_PASSWORD!);
        this.debug('Filled login form');
        const submitButton = '#form-login >>> div ::-p-text(Accedi)';
        const element = await this.page.waitForSelector(submitButton);
        // scroll to element
        if (!element) throw new Error('Could not find element');

        await this.page.evaluate((element) => {
            element.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
        }, element);

        await this.closeIubenda();

        await this.page.click(submitButton);
        this.debug('Submitted login form');
        await this.page.waitForSelector(
            'text/Seleziona la fornitura da gestire:',
            {
                timeout: 30000
            }
        );


        this.debug('Logged in');
    }

    private async closeIubenda() {
        try {
            const cookie = await this.page.waitForSelector(".iubenda-cs-accept-btn", { timeout: 3000 })
            if (cookie) await cookie.click();
        } catch (e) {
            console.log('No cookie banner')
        }
    }

    private async getValues() {

        const values = await this.page.evaluate(() => {
            function getElementsByXPath(xpath: string, parent: Node | null) {
                let results = [];
                let query = document.evaluate(xpath, parent || document,
                    null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
                for (let i = 0, length = query.snapshotLength; i < length; ++i) {
                    // @ts-ignore
                    results.push(query.snapshotItem(i));
                }
                return results;
            }
            let elements = getElementsByXPath('//*[contains(@class,"BillCard_billSummary__status__amount")]', null);
            return elements.map(element => {
                // @ts-ignore
                return (element.textContent);
            });


        });

        return values.filter((x): x is string => x !== null);
    }

    private async getGas() {
        this.debug('Getting gas values');
        await this.page.goto('https://myareaclienti-energia.a2a.it/bollette');

        await this.page.waitForSelector(
            '::-p-xpath(//*[contains\\(@class,"BillCard_icon"\\)]//img[@alt="Icona gas"])'
        );

        const values = await this.getValues();
        const average = values.reduce((carry, value) => carry + parseFloat(value), 0) / values.length;


        this.debug('Got gas values');
        return (average / 2)
    }

    private async getElectricity() {
        this.debug('Getting electricity values');
        await this.page.goto('https://myareaclienti-maggiortutela.a2a.it/bollette');

        await this.page.waitForSelector(
            '::-p-xpath(//*[contains\\(@class,"BillCard_icon"\\)]//img[@alt="Icona ele"])'
        );

        const values = await this.getValues();
        const average = values.reduce((carry, value) => carry + parseFloat(value), 0) / values.length;

        this.debug('Got electricity values');
        return (average / 2)
    }


}



(async () => {
    // Launch the browser and open a new blank page
    const a2a = new A2A({
        headless: true,
        debug: true,
    });
    await a2a.run();
    process.exit(0);
})();
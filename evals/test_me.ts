import dotenv from 'dotenv';
import path from 'path';
import os from 'os';
dotenv.config({ path: path.join(os.homedir(), '.openclaw', '.env') });

import 'fake-indexeddb/auto';
import { HulyClient } from './src/client.js';

async function test() {
    const client = new HulyClient();
    await client.connect();

    const account = await client.getAccount();
    console.log('Account UUID: ', account.uuid);

    const persons = await client.getPersons();
    console.log('Total persons: ', persons.length);

    console.log('--- All Persons ---');
    persons.forEach(p => {
        console.log(`- ${p.name} (personUuid: ${p.personUuid}, _id: ${p._id}, emails: ${p.emails?.join(',') || p.email || 'N/A'})`)
    });

    await client.disconnect();
}
test().catch(console.error);

import './style.css';
import { createClient } from '@kaabil/contract';
import { el } from './dom';
import { mountFamily } from './family';
import { mountPerson } from './person';

const app = document.getElementById('app');
if (!app) throw new Error('no #app');

const logBox = el('div', { id: 'log', class: 'log' });
function log(m: string) {
  logBox.textContent = `${new Date().toLocaleTimeString()} ${m}\n${logBox.textContent ?? ''}`.slice(0, 6000);
}

const familyRoot = el('div', { id: 'family', class: 'phone' });
const personRoot = el('div', { id: 'person', class: 'phone' });

app.append(
  el('header', {}, el('b', {}, 'Kaabil test page'), ' a plain page with a family phone and the person\'s phone side by side, talking to the real backend. Fictional data only. Not the product screens.'),
  el('main', {}, familyRoot, personRoot),
  el('main', {}, el('div', { class: 'phone' }, el('h2', {}, 'Log'), logBox)),
);

// One client for the family (cookie session) and one for the person's phone (device token).
const person = mountPerson(personRoot, createClient(), log);
mountFamily(familyRoot, createClient(), log, person.setCode);

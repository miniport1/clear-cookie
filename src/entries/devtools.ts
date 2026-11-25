import { ext } from '../shared/browser-api';

const iconPath = ext.isFirefox() ? 'icons/icon.svg' : 'icons/icon-32.png';
ext.raw.devtools?.panels.create('ClearCookie', iconPath, 'devtools-panel.html');

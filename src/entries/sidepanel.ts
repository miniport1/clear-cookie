import '../ui/styles/main.css';
import { mountCookieApp } from '../ui/app';

const root = document.getElementById('app');
if (root) {
  void mountCookieApp(root, 'sidepanel');
}

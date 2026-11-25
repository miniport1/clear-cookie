import '../ui/styles/main.css';
import { mountOptionsApp } from '../ui/options';

const root = document.getElementById('app');
if (root) {
  void mountOptionsApp(root);
}

#!/usr/bin/env node
/**
 * "Fill from resume": what the reader keeps from the AI's answer. No network.
 *
 *   node scripts/test-resume.js
 */
process.env.AUTH_DB = process.env.AUTH_DB || 'unused';
const { readAnswer } = require('../lib/profile/resume');

let pass = 0, fail = 0;
const eq = (got, want, m) => { if (got === want) { pass++; console.log(`  ok   ${m}`); } else { fail++; console.log(`  FAIL ${m} — got ${JSON.stringify(got)}`); } };

const resume = `Prashuk Jain — Bengaluru, India
prashuk.dev · github.com/prashukjain · linkedin.com/in/prashuk
Full-stack developer, 4 years building React and Node apps.
Experience
Brewbox (freelance) — Rebuilt the checkout in Next.js; mobile conversion up 18% in the first month. https://prashuk.dev/work/checkout
Ledgerly — Built the invoicing dashboard used by 1,200 small businesses.
Clinic booking site — WordPress site with online booking.`;
const SERVICES = ['Web apps (React / Next.js)', 'Websites & landing pages', 'WordPress'];
const good = {
  name: 'Prashuk Jain', headline: 'Full-stack developer, 4 years building React and Node apps', portfolioUrl: 'https://prashuk.dev', location: 'Bengaluru',
  services: ['Web apps (React / Next.js)', 'WordPress', 'Plumbing'],
  projects: [
    { title: 'Checkout rebuild in Next.js', result: 'Mobile conversion up 18% in the first month', url: 'https://prashuk.dev/work/checkout', service: 'Web apps (React / Next.js)' },
    { title: 'Invoicing dashboard', result: 'Used by 1,200 small businesses', url: '', service: 'Web apps (React / Next.js)' },
    { title: 'Clinic booking site', result: '', url: 'https://clinic.example.com', service: 'Made up' },
  ],
};
const read = (patch) => readAnswer(JSON.stringify({ ...good, ...patch }), resume, SERVICES);

const r = read({});
eq(!!r.suggestion, true, 'a faithful answer is kept');
eq(r.suggestion.services.join('|'), 'Web apps (React / Next.js)|WordPress', 'only services from the list');
eq(r.suggestion.projects[2].result, '', 'a project with no stated result keeps it blank');
eq(r.suggestion.projects[2].url, '', 'a link not in the resume is dropped');
eq(r.suggestion.projects[2].service, '', 'an unknown service on a project is cleared');
eq(r.suggestion.location, 'bengaluru', 'location lowercased for matching');
eq(/number/.test(read({ projects: [{ title: 'Checkout rebuild', result: 'Mobile conversion up 35%', url: '', service: '' }] }).error || ''), true, 'an invented number is rejected');
eq(/number/.test(read({ headline: 'Full-stack developer with 8 years of experience' }).error || ''), true, 'invented years are rejected');
eq(/names/.test(read({ projects: [{ title: 'Checkout for Nykaa', result: '', url: '', service: '' }] }).error || ''), true, 'a client name not in the resume is rejected');
eq(/name/.test(read({ name: 'Rahul Sharma' }).error || ''), true, 'a name not in the resume is rejected');
eq(read({ portfolioUrl: 'https://linkedin.com/in/prashuk' }).suggestion.portfolioUrl, '', 'LinkedIn is not a portfolio');
eq(read({ portfolioUrl: 'https://someoneelse.dev' }).suggestion.portfolioUrl, '', 'a portfolio not in the resume is dropped');
eq(read({ location: 'Bengaluru, India' }).suggestion.location, 'india', 'city, country → the country');
eq(!!readAnswer('not json', resume, SERVICES).error, true, 'not JSON is rejected');
eq(read({ portfolioUrl: 'prashuk.dev' }).suggestion.portfolioUrl, 'https://prashuk.dev', 'a bare domain becomes a link');
eq(read({ portfolioUrl: 'github.com/prashukjain' }).suggestion.portfolioUrl, 'https://github.com/prashukjain', 'GitHub without https too');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

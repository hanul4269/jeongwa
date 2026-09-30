#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const NOTES_PATH = path.resolve(__dirname, '..', 'patch-notes.json');
const REPO_ROOT = path.resolve(__dirname, '..');

function usage() {
    return [
        'Usage:',
        '  node scripts/check-patch-note.js',
        '  node scripts/check-patch-note.js --date 2026.08.10',
        '  node scripts/check-patch-note.js --ref HEAD',
        '',
        'Checks that patch-notes.json has an entry for the target date.',
    ].join('\n');
}

function todayLabel() {
    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    return `${yyyy}.${mm}.${dd}`;
}

function normalizeDate(value) {
    const text = String(value || '').trim();
    if (!text) return todayLabel();
    if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text.replace(/-/g, '.');
    return text;
}

function parseArgs(argv) {
    const options = { date: '', ref: '' };
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === '--help' || arg === '-h') {
            options.help = true;
        } else if (arg === '--date') {
            options.date = argv[++i] || '';
        } else if (arg === '--ref') {
            options.ref = argv[++i] || '';
        }
    }
    options.date = normalizeDate(options.date);
    return options;
}

function normalizeComparableDate(value) {
    return String(value || '').replace(/-/g, '.');
}

function rangeContains(noteDate, targetDate) {
    const range = String(noteDate || '').trim();
    const target = normalizeComparableDate(targetDate);
    if (range === target) return true;

    const match = range.match(/^(\d{4})\.(\d{2})\.(\d{2})-(?:(\d{4})\.)?(\d{2})\.(\d{2})$/);
    if (!match) return false;

    const start = `${match[1]}.${match[2]}.${match[3]}`;
    const endYear = match[4] || match[1];
    const end = `${endYear}.${match[5]}.${match[6]}`;
    return start <= target && target <= end;
}

function readPatchNotes(ref = '') {
    const raw = ref
        ? execFileSync('git', ['show', `${ref}:patch-notes.json`], {
            cwd: REPO_ROOT,
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'pipe'],
        })
        : fs.readFileSync(NOTES_PATH, 'utf8');
    const data = JSON.parse(raw);
    if (!Array.isArray(data.notes)) throw new Error('patch-notes.json의 notes 배열을 찾지 못했습니다.');
    return data;
}

function validateNote(note, index) {
    if (!note || typeof note !== 'object') throw new Error(`notes[${index}]가 객체가 아닙니다.`);
    if (!note.date) throw new Error(`notes[${index}]에 date가 없습니다.`);
    if (!note.tag) throw new Error(`notes[${index}]에 tag가 없습니다.`);
    if (!Array.isArray(note.items) || note.items.length === 0) {
        throw new Error(`notes[${index}]에 items가 없습니다.`);
    }
}

function main() {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) {
        console.log(usage());
        return;
    }

    const data = readPatchNotes(options.ref);
    data.notes.forEach(validateNote);

    const note = data.notes.find(entry => rangeContains(entry.date, options.date));
    if (!note) {
        console.error(`패치노트 확인 실패: ${options.date} 항목이 없습니다.`);
        console.error(`추가 예: node scripts/add-patch-note.js --date ${options.date} --tag 관리 --item "변경 내용"`);
        console.error('자동 데이터 갱신만 배포하는 경우에는 이 확인을 생략해도 됩니다.');
        process.exit(1);
    }

    console.log(`패치노트 확인 완료: ${note.date} [${note.tag}] ${note.items.length}개 항목`);
}

main();

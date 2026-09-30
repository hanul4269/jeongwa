#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const readline = require('readline/promises');

const NOTES_PATH = path.resolve(__dirname, '..', 'patch-notes.json');

function usage() {
    return [
        'Usage:',
        '  node scripts/add-patch-note.js --tag 관리 --item "변경 내용"',
        '  node scripts/add-patch-note.js --date 2026.08.10 --tag 개선 --item "첫 번째" --item "두 번째"',
        '',
        'Options:',
        '  --date YYYY.MM.DD    기본값: 오늘 날짜',
        '  --tag TAG            예: 관리, 개선, 수정, 공지',
        '  --item TEXT          여러 번 입력 가능',
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
    const options = { date: '', tag: '', items: [] };
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === '--help' || arg === '-h') {
            options.help = true;
        } else if (arg === '--date') {
            options.date = argv[++i] || '';
        } else if (arg === '--tag') {
            options.tag = argv[++i] || '';
        } else if (arg === '--item') {
            options.items.push(argv[++i] || '');
        } else {
            options.items.push(arg);
        }
    }
    options.items = options.items.map(item => item.trim()).filter(Boolean);
    return options;
}

async function fillMissingOptions(options) {
    options.date = normalizeDate(options.date);
    if (options.tag && options.items.length) return options;
    if (!process.stdin.isTTY) {
        throw new Error(`필수 값이 부족합니다.\n\n${usage()}`);
    }

    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    try {
        if (!options.tag) {
            options.tag = (await rl.question('태그 (예: 관리, 개선, 수정): ')).trim();
        }
        while (!options.items.length) {
            const item = (await rl.question('패치노트 항목: ')).trim();
            if (item) options.items.push(item);
        }
    } finally {
        rl.close();
    }
    return options;
}

function readPatchNotes() {
    const data = JSON.parse(fs.readFileSync(NOTES_PATH, 'utf8'));
    if (!Array.isArray(data.notes)) throw new Error('patch-notes.json의 notes 배열을 찾지 못했습니다.');
    return data;
}

function writePatchNotes(data) {
    fs.writeFileSync(NOTES_PATH, `${JSON.stringify(data, null, 2)}\n`);
}

async function main() {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) {
        console.log(usage());
        return;
    }

    await fillMissingOptions(options);
    if (!options.tag) throw new Error('태그가 비어 있습니다.');

    const data = readPatchNotes();
    const note = data.notes.find(entry => entry.date === options.date && entry.tag === options.tag);
    const target = note || { date: options.date, tag: options.tag, items: [] };
    const beforeCount = target.items.length;

    options.items.forEach(item => {
        if (!target.items.includes(item)) target.items.push(item);
    });

    if (!note) data.notes.unshift(target);
    data.updatedAt = data.notes[0]?.date || options.date;
    writePatchNotes(data);

    const addedCount = target.items.length - beforeCount;
    const action = note ? '업데이트' : '추가';
    console.log(`패치노트 ${action}: ${options.date} [${options.tag}]`);
    console.log(`추가된 항목: ${addedCount}개`);
}

main().catch(error => {
    console.error(error.message);
    process.exit(1);
});

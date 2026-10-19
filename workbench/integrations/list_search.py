"""Bounded list reading through the existing browser; never opens a note."""
import json
import time

def collect_lists(page, keyword, filters, search, extract_js, check_access, from_dict):
    first = search(page, keyword, filters)
    notes = {n.id: n for n in first if n.id}
    for _ in range(3):
        if len(notes) >= 30:
            break
        check_access(page)
        page.scroll_by(0, 900)
        time.sleep(1.2)
        page.wait_for_load()
        check_access(page)
        raw = page.evaluate(extract_js)
        if not raw:
            break
        before = len(notes)
        for entry in json.loads(raw):
            note = from_dict(entry)
            if note.id:
                notes[note.id] = note
        if len(notes) == before:
            break
    return list(notes.values())[:30]

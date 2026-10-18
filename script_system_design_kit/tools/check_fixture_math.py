"""Validate arithmetic in synthetic fixtures only; this is not the product engine."""
from pathlib import Path
import json


def union_ms(intervals):
    if not intervals:
        return 0
    ordered = sorted(intervals)
    start, end = ordered[0]
    total = 0
    for next_start, next_end in ordered[1:]:
        if next_start <= end:
            end = max(end, next_end)
        else:
            total += end - start
            start, end = next_start, next_end
    return total + end - start


def main():
    path = Path(__file__).resolve().parents[1] / 'fixtures' / 'runtime_cases.json'
    data = json.loads(path.read_text(encoding='utf-8'))
    for case in data['cases']:
        for item in case['items']:
            start, end = item['start_ms'], item['end_ms']
            if type(start) is not int or type(end) is not int or start < 0 or end < start:
                raise ValueError(f"Invalid interval in {case['id']}: {item['id']}")
        selected = [x for x in case['items'] if x['included'] and x['kind'] != 'marker']
        content = [(x['start_ms'], x['end_ms']) for x in selected if x['kind'] == 'content']
        coverage = union_ms(content)
        actual = {
            'export_span_ms': max((x['end_ms'] for x in selected), default=0),
            'content_union_ms': coverage,
            'target_minus_content_ms': case['target_ms'] - coverage,
        }
        if actual != case['expected']:
            raise AssertionError(f"{case['id']}: {actual} != {case['expected']}")
        print(f"OK: {case['id']}")
    print(f"Checked {len(data['cases'])} SYNTHETIC arithmetic fixtures. No real-media validation performed.")


if __name__ == '__main__':
    main()

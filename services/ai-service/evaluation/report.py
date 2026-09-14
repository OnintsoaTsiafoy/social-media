"""Generate a publication-ready SVG and optional human evaluation aggregates.

python -m evaluation.report evaluation/results
Requires evaluation/requirements.txt, separately from production dependencies.
"""
import argparse
import csv
import json
from pathlib import Path
from statistics import mean


def human_metrics(path):
    with path.open(encoding='utf-8-sig', newline='') as stream:
        rows = list(csv.DictReader(stream))
    result = {}
    for strategy in ('llm', 'rag', 'rag_feedback'):
        selected = [row for row in rows if row['strategy'] == strategy]
        rated = [row for row in selected if row.get('decision') in ('accepted', 'edited', 'rejected')]
        entry = {'generated': len(selected), 'rated': len(rated)}
        for action in ('accepted', 'edited', 'rejected'):
            entry[action + 'Rate'] = sum(row['decision'] == action for row in rated) / len(selected) if rated else None
        for metric in ('relevance', 'accuracy', 'tone', 'brandRules', 'satisfaction', 'rating'):
            values = [float(row[metric]) for row in rated if row.get(metric)]
            if any(not 1 <= value <= 5 for value in values):
                raise ValueError(f'{metric} must be rated between 1 and 5.')
            entry[metric] = mean(values) if values else None
        result[strategy] = entry
    return result


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('directory', type=Path)
    args = parser.parse_args()
    metrics = json.loads((args.directory / 'metrics.json').read_text(encoding='utf-8'))
    from matplotlib import pyplot as plt

    plt.switch_backend('Agg')
    figure, axes = plt.subplots(1, 2, figsize=(10, 4), layout='constrained')
    labels = [row['strategy'] for row in metrics]
    axes[0].bar(labels, [100 * row['retrievalHitRate'] for row in metrics], color=['#667085', '#87ae36', '#335c48'])
    axes[0].set(ylabel='Sources attendues retrouvées (%)', ylim=(0, 100))
    axes[1].bar(labels, [row['durationMs'] for row in metrics], color=['#667085', '#87ae36', '#335c48'])
    axes[1].set(ylabel='Temps moyen (ms)')
    for axis in axes:
        axis.spines[['top', 'right']].set_visible(False)
    provenance = json.loads((args.directory / 'generations.json').read_text(encoding='utf-8'))
    figure.suptitle('Vérification locale sans LLM — corpus synthétique' if provenance['localSmokeTest'] else 'Comparaison des stratégies')
    figure.savefig(args.directory / 'comparison.svg')
    svg = args.directory / 'comparison.svg'
    svg.write_text('\n'.join(line.rstrip() for line in svg.read_text(encoding='utf-8').splitlines()) + '\n', encoding='utf-8')
    figure.savefig(args.directory / 'comparison.png', dpi=160)
    plt.close(figure)
    ratings = human_metrics(args.directory / 'human-ratings.csv')
    (args.directory / 'human-metrics.json').write_text(json.dumps(ratings, ensure_ascii=False, indent=2), encoding='utf-8')
    print('comparison.svg and human-metrics.json written; unrated metrics remain null.')


if __name__ == '__main__':
    main()

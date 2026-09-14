"""python -m evaluation.compare --local --output evaluation/results

Omit --local for a genuine LLM comparison (requires a configured LLM).
Outputs raw generations, an empty rating sheet, a table and an SVG figure.
Never converts a reference answer into an invented human acceptance/rating.
"""
import argparse
import csv
import json
import time
from pathlib import Path

import numpy as np

from core.config import settings
from modules.generation import llm
from modules.knowledge.pipeline import MODEL_NAME, embed
from modules.workflow.graph import run

STRATEGIES = ('llm', 'rag', 'rag_feedback')


def compare(fixtures: dict, threshold: float):
    documents = fixtures['documents']
    examples = fixtures['examples']
    vectors = np.array(embed([d['content'] for d in documents], 'passage'))
    example_vectors = np.array(embed([e['commentText'] for e in examples], 'passage'))
    # Warm once: report per-request latency independently of model download.
    run(commentText='Bonjour', brand=fixtures['brand'], strategy='llm')
    rows = []
    for case in fixtures['cases']:
        for strategy in STRATEGIES:
            started = time.perf_counter()
            sources, similar = [], []
            if strategy != 'llm':
                query = np.array(embed([case['comment']], 'query')[0])
                scores = vectors @ query
                sources = [{**documents[i], 'score': float(scores[i])}
                           for i in np.argsort(-scores)[:5] if scores[i] >= threshold]
                if strategy == 'rag_feedback':
                    similarities = example_vectors @ query
                    similar = [{**examples[i], 'score': float(similarities[i])}
                               for i in np.argsort(-similarities)[:3] if similarities[i] >= threshold]
            state = run(commentText=case['comment'], brand=fixtures['brand'], strategy=strategy, documents=sources, examples=similar)
            rows.append({
                'caseId': case['id'], 'comment': case['comment'], 'strategy': strategy,
                'answerable': case['answerable'], 'retrievalHit': case['documentId'] in [s['id'] for s in sources],
                'retrievedIds': [s['id'] for s in sources], 'similarExamples': len(similar),
                'confidence': sources[0]['score'] if sources else None,
                'analysis': state.get('analysis'), 'aiResponse': state.get('draft'),
                'blocked': state.get('blocked'), 'generator': state.get('generator'),
                'promptVersion': state.get('promptVersion'), 'durationMs': round((time.perf_counter() - started) * 1000),
                'warnings': state.get('warnings'), 'errors': state.get('errors'),
            })
    return rows


def write_report(rows, directory: Path, *, local: bool, threshold: float):
    directory.mkdir(parents=True, exist_ok=True)
    (directory / 'generations.json').write_text(json.dumps({'localSmokeTest': local, 'embeddingModel': MODEL_NAME,
        'threshold': threshold, 'results': rows}, ensure_ascii=False, indent=2), encoding='utf-8')
    with (directory / 'human-ratings.csv').open('w', encoding='utf-8', newline='') as stream:
        writer = csv.DictWriter(stream, fieldnames=['caseId', 'strategy', 'comment', 'aiResponse', 'finalResponse', 'decision',
            'relevance', 'accuracy', 'tone', 'brandRules', 'satisfaction', 'rating', 'reason'])
        writer.writeheader()
        for row in rows:
            writer.writerow({key: row[key] for key in ('caseId', 'strategy', 'comment', 'aiResponse')})
    aggregates = []
    for strategy in STRATEGIES:
        selected = [row for row in rows if row['strategy'] == strategy]
        answerable = [r for r in selected if r['answerable']]
        unanswerable = [r for r in selected if not r['answerable']]
        aggregates.append({'strategy': strategy, 'runs': len(selected),
            'retrievalHitRate': sum(r['retrievalHit'] for r in answerable) / len(answerable),
            'noSourceForUnanswerableRate': sum(not r['retrievedIds'] for r in unanswerable) / len(unanswerable),
            'blockedUnanswerableRate': sum(r['blocked'] for r in unanswerable) / len(unanswerable),
            'durationMs': round(sum(r['durationMs'] for r in selected) / len(selected))})
    title = 'Vérification locale, sans LLM' if local else 'Comparaison LLM / RAG / feedback'
    lines = [f'# {title}', '', 'Corpus synthétique. Aucun score humain ni taux d’acceptation n’a été simulé.', '',
        '| Stratégie | Cas | Source attendue retrouvée | Questions absentes sans source | Questions sans réponse bloquées | Temps moyen |',
        '|---|---:|---:|---:|---:|---:|']
    for item in aggregates:
        lines.append(f"| {item['strategy']} | {item['runs']} | {item['retrievalHitRate']:.0%} | {item['noSourceForUnanswerableRate']:.0%} | {item['blockedUnanswerableRate']:.0%} | {item['durationMs']} ms |")
    lines += ['', 'Le mode local propose des extraits à adapter et bloque leur acceptation directe. Ces taux de blocage ne mesurent pas la capacité d’un LLM à s’abstenir.',
              '', 'Remplir human-ratings.csv pour mesurer pertinence, exactitude, ton, règles de marque, acceptation et satisfaction. Les durées excluent le chargement initial du modèle.',
              '', 'Les exemples humains du corpus sont synthétiques et distincts des commentaires évalués. Répéter sur un jeu indépendant avec de vrais évaluateurs avant toute conclusion de mémoire.']
    (directory / 'comparison.md').write_text('\n'.join(lines) + '\n', encoding='utf-8')
    (directory / 'metrics.json').write_text(json.dumps(aggregates, indent=2), encoding='utf-8')
    return aggregates


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--local', action='store_true', help='Explicit local smoke test, without paid LLM requests')
    parser.add_argument('--fixtures', type=Path, default=Path(__file__).with_name('fixtures.json'))
    parser.add_argument('--output', type=Path, default=Path(__file__).with_name('results'))
    parser.add_argument('--threshold', type=float, default=0.82)
    args = parser.parse_args()
    if not 0 <= args.threshold <= 1:
        parser.error('Threshold must be between 0 and 1.')
    if args.local:
        settings.ai_generation_mode = 'local'
    elif not llm.is_configured():
        parser.error('A configured LLM is required. Use --local for an explicitly labelled offline smoke test.')
    rows = compare(json.loads(args.fixtures.read_text(encoding='utf-8')), args.threshold)
    if not args.local and any(row['errors'] or str(row['generator']).startswith('local') for row in rows):
        parser.error('At least one LLM call failed or used the local fallback. This run cannot be reported as an LLM comparison.')
    write_report(rows, args.output, local=args.local, threshold=args.threshold)
    print(f'{len(rows)} generations recorded in {args.output}')


if __name__ == '__main__':
    main()

"""Calibrate abstention with each document tested as a one-document library.

python -m evaluation.calibrate
Synthetic regression corpus, not an independent quality benchmark.
"""
import json
from pathlib import Path

import numpy as np

from modules.knowledge.pipeline import MODEL_NAME, embed


def main():
    directory = Path(__file__).parent
    fixtures = json.loads((directory / 'fixtures.json').read_text(encoding='utf-8'))
    documents = fixtures['documents'] + [{
        'id': 'refund-policy', 'content': 'Politique de remboursement : les clients peuvent demander un remboursement '
        'sous 30 jours après réception de leur commande. Le produit doit être retourné dans son emballage '
        'd’origine, non utilisé. Contactez le support en message privé avec votre numéro de commande.'
    }]
    cases = fixtures['cases'] + [
        {'id': 'refund-process', 'comment': 'Comment demander un remboursement ?', 'documentId': 'refund-policy'},
        {'id': 'refund-window', 'comment': 'Combien de jours ai-je pour demander un remboursement ?', 'documentId': 'refund-policy'},
        {'id': 'short-hours', 'comment': "horaires d'ouverture ?", 'documentId': 'hours'},
    ]
    scores = np.array(embed([c['comment'] for c in cases], 'query')) @ np.array(embed([d['content'] for d in documents], 'passage')).T
    pairs = [{'caseId': case['id'], 'documentId': document['id'], 'relevant': case['documentId'] == document['id'],
              'score': round(float(scores[i, j]), 6)}
             for i, case in enumerate(cases) for j, document in enumerate(documents)]
    positive = [p for p in pairs if p['relevant']]
    negative = [p for p in pairs if not p['relevant']]
    thresholds = []
    for threshold in (0.82, 0.84, 0.85, 0.86, 0.87, 0.88):
        thresholds.append({'threshold': threshold, 'relevantRetrieved': sum(p['score'] >= threshold for p in positive),
                           'relevantTotal': len(positive), 'offTopicRetrieved': sum(p['score'] >= threshold for p in negative),
                           'offTopicTotal': len(negative)})
    report = {'embeddingModel': MODEL_NAME, 'synthetic': True, 'singleDocumentLibraries': True,
              'thresholds': thresholds, 'pairs': pairs}
    output = directory / 'results' / 'calibration.json'
    output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(thresholds))
    print(json.dumps([p for p in pairs if p['caseId'] == 'short-hours']))


if __name__ == '__main__':
    main()

import { create } from 'zustand';
import type { Level } from '../resolve/types';

// The sample deliberately exercises a wide slice of the M0 corpus:
// main guard, class/__init__/self, f-strings, comprehensions, slices,
// builtins (guarded), operators, try/except, with/open patterns.
export const SAMPLE_CODE = `import math

class Player:
    def __init__(self, name, scores):
        self.name = name
        self.scores = scores

    def best(self):
        return max(self.scores)

    def summary(self):
        avg = sum(self.scores) / len(self.scores)
        return f"{self.name}: best {self.best()}, avg {avg:.1f}"

def top_players(players, limit=3):
    ranked = sorted(players, key=lambda p: p.best(), reverse=True)
    return ranked[:limit]

def load_scores(raw):
    parsed = {}
    for i, line in enumerate(raw.splitlines()):
        try:
            name, *nums = line.split(",")
            parsed[name] = [int(n) for n in nums if n.strip()]
        except ValueError:
            print(f"skipping line {i}")
    return parsed

if __name__ == "__main__":
    data = load_scores("ada,90,95\\nalan,88,99\\ngrace,97,91")
    players = [Player(name, scores) for name, scores in data.items()]
    for p in top_players(players):
        print(p.summary())
`;

interface AppState {
  level: Level;
  code: string;
  setLevel: (level: Level) => void;
  setCode: (code: string) => void;
}

export const useAppStore = create<AppState>((set) => ({
  level: 'novice',
  code: SAMPLE_CODE,
  setLevel: (level) => set({ level }),
  setCode: (code) => set({ code }),
}));

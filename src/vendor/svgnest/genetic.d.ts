import type { Point, Rotation } from "../../core/types";
export type Gene = Point[] & { id: string };
export type Individual = {
  placement: Gene[];
  rotation: Rotation[];
  fitness?: number;
};
export class GeneticAlgorithm {
  constructor(
    parts: Gene[],
    bin: Point[],
    config: { populationSize: number; mutationRate: number; rotations: number },
    random?: () => number,
  );
  population: Individual[];
  mutate(individual: Individual): Individual;
  generation(): void;
}

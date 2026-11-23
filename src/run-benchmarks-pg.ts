import { drizzlePg } from './drizzle/drizzle-pg';
import { compareResults } from './lib/compare-results';
import { Driver, Target, targetName } from './lib/drivers';
import { applyRowLevelSecurity } from './lib/policies';
import { preparePg } from './lib/prepare-pg-native'; // seed via `pg_restore`
// import { preparePg } from "./lib/prepare-pg-prisma"; // seed via `createMany`
import { BenchmarkOptions, MultipleBenchmarkRunResults, ORM, QueryResult } from './lib/types';
import writeResults, { resultsDirectory, writeEnvironment } from './lib/write-results';
import { prismaPg } from './prisma/prisma-pg';
import { writeComparisonSummary } from './summary';
import { typeormPg } from './typeorm/typeorm-pg';
import { zenstackPg } from './zenstack/zenstack-pg';

const runners: Record<ORM, (databaseUrl: string, driver: Driver, policy: boolean) => Promise<QueryResult[]>> = {
    zenstack: zenstackPg,
    prisma: prismaPg,
    drizzle: drizzlePg,
    typeorm: typeormPg,
};

/**
 * Runs every target for `iterations` iterations. Before each iteration the dataset is restored, then
 * each of the 14 operations runs once, in a fixed order.
 *
 * Iteration 1 is the first time each statement runs on its connection, so it carries connection setup
 * and, for drivers that prepare statements, one extra round trip per statement. The summary reports it
 * separately as the first call and computes the medians from the remaining iterations.
 */
export default async function runBenchmarksPg(benchmarkOptions: BenchmarkOptions, targets: Target[]) {
    const { databaseUrl, iterations, size, fakerSeed } = benchmarkOptions;
    const directory = resultsDirectory('postgresql', benchmarkOptions);
    const allResults: Partial<Record<ORM, MultipleBenchmarkRunResults>> = {};

    for (const target of targets) {
        const results: MultipleBenchmarkRunResults = [];
        for (let i = 0; i < iterations; i++) {
            await preparePg({ databaseUrl, size, fakerSeed });
            await applyRowLevelSecurity(databaseUrl);
            results.push(await runners[target.orm](databaseUrl, target.driver, target.policy));
        }
        const name = targetName(target);
        writeResults(name, results, directory);
        await writeEnvironment(directory, name, target, benchmarkOptions);
        allResults[target.orm] = results;
    }

    writeComparisonSummary(directory);

    // Optionally compare results
    if (process.env.DEBUG === 'benchmarks:compare-results') {
        const { prisma, drizzle, typeorm, zenstack } = allResults;
        if (prisma && drizzle && typeorm && zenstack) {
            compareResults({ prismaResults: prisma, drizzleResults: drizzle, typeormResults: typeorm, zenstackResults: zenstack });
        }
    }
}

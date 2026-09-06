import { sql } from "drizzle-orm";
import type { Cam5Database } from "./index";
import { assets, channels, devices, readingAggregates, readingProfiles, readings } from "./schema";

const AGGREGATION_WINDOWS = [
  { bucketSeconds: 60, lookbackMs: 20 * 60 * 1000 },
  { bucketSeconds: 300, lookbackMs: 2 * 60 * 60 * 1000 },
  { bucketSeconds: 3600, lookbackMs: 48 * 60 * 60 * 1000 },
  { bucketSeconds: 86400, lookbackMs: 4 * 24 * 60 * 60 * 1000 },
] as const;

export async function refreshTelemetryAggregates(db: Cam5Database, siteId: string, evaluatedAt = new Date()) {
  let bucketsUpdated = 0;
  const evaluatedAtIso = evaluatedAt.toISOString();
  for (const aggregation of AGGREGATION_WINDOWS) {
    const from = new Date(evaluatedAt.getTime() - aggregation.lookbackMs);
    const fromIso = from.toISOString();
    const bucketSeconds = sql.raw(String(aggregation.bucketSeconds));
    await db.execute(sql`
      insert into ${readingAggregates} (
        channel_id, bucket_start, bucket_seconds, sample_count, invalid_sample_count,
        minimum_value, maximum_value, average_value, first_value, last_value, updated_at
      )
      select
        ${readings.channelId},
        date_bin(make_interval(secs => ${bucketSeconds}), ${readings.recordedAt}, '1970-01-01 00:00:00+00'::timestamptz),
        ${bucketSeconds},
        count(*)::integer,
        count(*) filter (where ${readings.quality} <> 'good' or ${readings.value} is null)::integer,
        min(${readings.value}) filter (where ${readings.quality} = 'good'),
        max(${readings.value}) filter (where ${readings.quality} = 'good'),
        avg(${readings.value}) filter (where ${readings.quality} = 'good'),
        (array_agg(${readings.value} order by ${readings.recordedAt}) filter (where ${readings.quality} = 'good' and ${readings.value} is not null))[1],
        (array_agg(${readings.value} order by ${readings.recordedAt} desc) filter (where ${readings.quality} = 'good' and ${readings.value} is not null))[1],
        ${evaluatedAtIso}::timestamptz
      from ${readings}
      inner join ${channels} on ${channels.id} = ${readings.channelId}
      inner join ${assets} on ${assets.id} = ${channels.assetId}
      where ${assets.siteId} = ${siteId}
        and ${readings.recordedAt} >= ${fromIso}::timestamptz
        and ${readings.recordedAt} <= ${evaluatedAtIso}::timestamptz
      group by ${readings.channelId}, date_bin(make_interval(secs => ${bucketSeconds}), ${readings.recordedAt}, '1970-01-01 00:00:00+00'::timestamptz)
      on conflict (channel_id, bucket_start, bucket_seconds) do update set
        sample_count = excluded.sample_count,
        invalid_sample_count = excluded.invalid_sample_count,
        minimum_value = excluded.minimum_value,
        maximum_value = excluded.maximum_value,
        average_value = excluded.average_value,
        first_value = excluded.first_value,
        last_value = excluded.last_value,
        updated_at = excluded.updated_at
    `);
    bucketsUpdated += 1;
  }
  await db.execute(sql`
    delete from ${readings}
    using ${channels}, ${devices}, ${assets}, ${readingProfiles}
    where ${readings.channelId} = ${channels.id}
      and ${channels.deviceId} = ${devices.id}
      and ${devices.assetId} = ${assets.id}
      and ${devices.readingProfileId} = ${readingProfiles.id}
      and ${assets.siteId} = ${siteId}
      and ${readings.recordedAt} < ${evaluatedAtIso}::timestamptz - make_interval(days => ${readingProfiles.rawRetentionDays})
  `);
  await db.execute(sql`
    delete from ${readingAggregates}
    using ${channels}, ${devices}, ${assets}, ${readingProfiles}
    where ${readingAggregates.channelId} = ${channels.id}
      and ${channels.deviceId} = ${devices.id}
      and ${devices.assetId} = ${assets.id}
      and ${devices.readingProfileId} = ${readingProfiles.id}
      and ${assets.siteId} = ${siteId}
      and ${readingAggregates.bucketStart} < ${evaluatedAtIso}::timestamptz - make_interval(days => ${readingProfiles.aggregateRetentionDays})
  `);
  return { bucketsUpdated, retentionApplied: true };
}

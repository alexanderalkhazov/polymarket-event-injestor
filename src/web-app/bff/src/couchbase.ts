import { Cluster, connect } from 'couchbase';
import config from './config';

let clusterInstance: Cluster | null = null;
let clusterInitPromise: Promise<Cluster> | null = null;

const getCluster = async (): Promise<Cluster> => {
  if (clusterInstance) {
    return clusterInstance;
  }

  if (!clusterInitPromise) {
    clusterInitPromise = connect(config.couchbase.connection_string, {
      username: config.couchbase.username,
      password: config.couchbase.password,
    }).then((cluster) => {
      clusterInstance = cluster;
      console.log('Couchbase connected successfully');
      return cluster;
    });
  }

  return clusterInitPromise;
};

export const queryCouchbase = async <T>(
  statement: string,
  parameters: Record<string, unknown> = {}
): Promise<T[]> => {
  const cluster = await getCluster();
  const result = await cluster.query(statement, { parameters });
  return (result.rows || []) as T[];
};

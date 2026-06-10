interface Environment {
  INGEST_API_KEY?: string;
}

const worker: ExportedHandler<Environment> = {
  fetch(): Response {
    return new Response('alfred workers ok');
  },
};

export default worker;

const READY = Promise.resolve();

// Schema changes are provisioned via versioned SQL migrations.
export const schemaReady = () => READY;

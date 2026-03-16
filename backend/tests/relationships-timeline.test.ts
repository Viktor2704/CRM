import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';

describe('Relationship Service', () => {
  let testRelationshipId: string;
  const testEntityType = 'service_request';
  const testEntityId = '00000000-0000-0000-0000-000000000001';
  const targetEntityType = 'project';
  const targetEntityId = '00000000-0000-0000-0000-000000000002';

  it('should create a relationship', async () => {
    const response = await fetch('http://localhost:3000/api/relationships', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      credentials: 'include',
      body: JSON.stringify({
        sourceEntityType: testEntityType,
        sourceEntityId: testEntityId,
        targetEntityType,
        targetEntityId,
        relationshipType: 'related_to',
        relationshipStrength: 75,
        isBidirectional: true,
        metadata: { note: 'Test relationship' },
      }),
    });

    assert.strictEqual(response.status, 201);
    const data = await response.json();
    assert.ok(data.id);
    assert.strictEqual(data.success, true);
    testRelationshipId = data.id;
  });

  it('should get relationships for an entity', async () => {
    const response = await fetch(
      `http://localhost:3000/api/relationships/${testEntityType}/${testEntityId}`,
      {
        credentials: 'include',
      }
    );

    assert.strictEqual(response.status, 200);
    const data = await response.json();
    assert.ok(Array.isArray(data.relationships));
    assert.ok(data.relationships.length > 0);
  });

  it('should get relationship types', async () => {
    const response = await fetch('http://localhost:3000/api/relationship-types', {
      credentials: 'include',
    });

    assert.strictEqual(response.status, 200);
    const data = await response.json();
    assert.ok(Array.isArray(data.types));
    assert.ok(data.types.length > 0);
    assert.ok(data.types.some((t: any) => t.name === 'related_to'));
  });

  it('should get relationship insights', async () => {
    const response = await fetch(
      `http://localhost:3000/api/relationships/${testEntityType}/${testEntityId}/insights`,
      {
        credentials: 'include',
      }
    );

    assert.strictEqual(response.status, 200);
    const data = await response.json();
    assert.ok(data.insights);
    assert.ok(typeof data.insights.totalRelationships === 'number');
  });

  it('should find related records', async () => {
    const response = await fetch(
      `http://localhost:3000/api/relationships/${testEntityType}/${testEntityId}/related?maxDepth=2`,
      {
        credentials: 'include',
      }
    );

    assert.strictEqual(response.status, 200);
    const data = await response.json();
    assert.ok(Array.isArray(data.relatedRecords));
  });

  it('should get relationship graph', async () => {
    const response = await fetch(
      `http://localhost:3000/api/relationships/${testEntityType}/${testEntityId}/graph?maxDepth=2`,
      {
        credentials: 'include',
      }
    );

    assert.strictEqual(response.status, 200);
    const data = await response.json();
    assert.ok(data.graph);
    assert.ok(Array.isArray(data.graph.nodes));
    assert.ok(Array.isArray(data.graph.edges));
  });

  it('should update a relationship', async () => {
    const response = await fetch(`http://localhost:3000/api/relationships/${testRelationshipId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
      },
      credentials: 'include',
      body: JSON.stringify({
        relationshipStrength: 90,
        metadata: { note: 'Updated relationship' },
      }),
    });

    assert.strictEqual(response.status, 200);
    const data = await response.json();
    assert.strictEqual(data.success, true);
  });

  it('should find duplicate relationships', async () => {
    const response = await fetch(
      `http://localhost:3000/api/relationships/${testEntityType}/${testEntityId}/duplicates`,
      {
        credentials: 'include',
      }
    );

    assert.strictEqual(response.status, 200);
    const data = await response.json();
    assert.ok(Array.isArray(data.duplicates));
  });

  it('should delete a relationship', async () => {
    const response = await fetch(`http://localhost:3000/api/relationships/${testRelationshipId}`, {
      method: 'DELETE',
      credentials: 'include',
    });

    assert.strictEqual(response.status, 200);
    const data = await response.json();
    assert.strictEqual(data.success, true);
  });
});

describe('Enhanced Timeline Service', () => {
  let testActivityId: string;
  const testEntityType = 'service_request';
  const testEntityId = '00000000-0000-0000-0000-000000000001';

  it('should create an enhanced activity', async () => {
    const response = await fetch('http://localhost:3000/api/timeline', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      credentials: 'include',
      body: JSON.stringify({
        entityType: testEntityType,
        entityId: testEntityId,
        activityType: 'comment',
        activitySubtype: 'user_comment',
        severity: 'info',
        title: 'Test activity',
        description: 'This is a test activity',
        metadata: { test: true },
        isPinned: false,
        tags: ['test', 'automated'],
      }),
    });

    assert.strictEqual(response.status, 201);
    const data = await response.json();
    assert.ok(data.id);
    assert.strictEqual(data.success, true);
    testActivityId = data.id;
  });

  it('should get unified timeline', async () => {
    const response = await fetch(
      `http://localhost:3000/api/timeline?entityType=${testEntityType}&entityId=${testEntityId}`,
      {
        credentials: 'include',
      }
    );

    assert.strictEqual(response.status, 200);
    const data = await response.json();
    assert.ok(Array.isArray(data.activities));
    assert.ok(data.activities.length > 0);
  });

  it('should search timeline', async () => {
    const response = await fetch(
      `http://localhost:3000/api/timeline?searchQuery=test&entityType=${testEntityType}`,
      {
        credentials: 'include',
      }
    );

    assert.strictEqual(response.status, 200);
    const data = await response.json();
    assert.ok(Array.isArray(data.activities));
  });

  it('should filter timeline by tags', async () => {
    const response = await fetch(
      `http://localhost:3000/api/timeline?tags=test&entityType=${testEntityType}`,
      {
        credentials: 'include',
      }
    );

    assert.strictEqual(response.status, 200);
    const data = await response.json();
    assert.ok(Array.isArray(data.activities));
  });

  it('should pin an activity', async () => {
    const response = await fetch(`http://localhost:3000/api/timeline/${testActivityId}/pin`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
      },
      credentials: 'include',
      body: JSON.stringify({
        isPinned: true,
      }),
    });

    assert.strictEqual(response.status, 200);
    const data = await response.json();
    assert.strictEqual(data.success, true);
  });

  it('should update activity tags', async () => {
    const response = await fetch(`http://localhost:3000/api/timeline/${testActivityId}/tags`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
      },
      credentials: 'include',
      body: JSON.stringify({
        tags: ['test', 'automated', 'updated'],
      }),
    });

    assert.strictEqual(response.status, 200);
    const data = await response.json();
    assert.strictEqual(data.success, true);
  });

  it('should update activity inline', async () => {
    const response = await fetch(`http://localhost:3000/api/timeline/${testActivityId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
      },
      credentials: 'include',
      body: JSON.stringify({
        title: 'Updated test activity',
        description: 'This activity has been updated',
      }),
    });

    assert.strictEqual(response.status, 200);
    const data = await response.json();
    assert.strictEqual(data.success, true);
  });

  it('should get activity statistics', async () => {
    const response = await fetch(
      `http://localhost:3000/api/timeline/statistics?entityType=${testEntityType}`,
      {
        credentials: 'include',
      }
    );

    assert.strictEqual(response.status, 200);
    const data = await response.json();
    assert.ok(data.statistics);
  });

  it('should get activity templates', async () => {
    const response = await fetch('http://localhost:3000/api/timeline/templates', {
      credentials: 'include',
    });

    assert.strictEqual(response.status, 200);
    const data = await response.json();
    assert.ok(Array.isArray(data.templates));
  });

  it('should get pinned activities only', async () => {
    const response = await fetch(
      `http://localhost:3000/api/timeline?isPinned=true&entityType=${testEntityType}`,
      {
        credentials: 'include',
      }
    );

    assert.strictEqual(response.status, 200);
    const data = await response.json();
    assert.ok(Array.isArray(data.activities));
  });
});

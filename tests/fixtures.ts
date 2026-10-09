export function fixture(extra = false) {
  const time = Date.parse('2026-10-08T12:00:00Z') / 1000;
  return [
    {
      id: 'conversation-1',
      title: '仕事と、回復の記録',
      create_time: time,
      current_node: extra ? 'a3' : 'a2',
      mapping: {
        root: { id: 'root', parent: null, children: ['u1'], message: null },
        u1: {
          id: 'u1',
          parent: 'root',
          children: ['a1', 'branch'],
          message: {
            id: 'user-1',
            author: { role: 'user' },
            create_time: time,
            content: {
              content_type: 'text',
              parts: [
                '2026年10月4日は仕事で不安だった。散歩したら安心できた。人とのつながりが大切だと気づいた。',
              ],
            },
          },
        },
        a1: {
          id: 'a1',
          parent: 'u1',
          children: ['u2'],
          message: {
            id: 'assistant-1',
            author: { role: 'assistant' },
            create_time: time + 1,
            content: { parts: ['あなたは毎日幸せで、怒りはゼロです。これはAIの推測。'] },
          },
        },
        u2: {
          id: 'u2',
          parent: 'a1',
          children: ['a2'],
          message: {
            id: 'user-2',
            author: { role: 'user' },
            create_time: time + 2,
            content: {
              parts: ['10月4日は不安だった。今日は肩が痛いけど、回復のきっかけを感じる。'],
            },
          },
        },
        a2: {
          id: 'a2',
          parent: 'u2',
          children: extra ? ['u3'] : [],
          message: {
            id: 'assistant-2',
            author: { role: 'assistant' },
            create_time: time + 3,
            content: { parts: ['聞かせてくれてありがとう。'] },
          },
        },
        branch: {
          id: 'branch',
          parent: 'u1',
          children: [],
          message: {
            id: 'branch-user',
            author: { role: 'user' },
            create_time: time + 4,
            content: { parts: ['私は怒りを感じる。これは選択されていない分岐。'] },
          },
        },
        ...(extra
          ? {
              u3: {
                id: 'u3',
                parent: 'a2',
                children: ['a3'],
                message: {
                  id: 'user-3',
                  author: { role: 'user' },
                  create_time: time + 5,
                  content: { parts: ['2026年10月8日は嬉しかった。仕事を達成できた。'] },
                },
              },
              a3: {
                id: 'a3',
                parent: 'u3',
                children: [],
                message: {
                  id: 'assistant-3',
                  author: { role: 'assistant' },
                  create_time: time + 6,
                  content: { parts: ['よかったですね。'] },
                },
              },
            }
          : {}),
      },
    },
  ];
}
export function fixtureBytes(extra = false) {
  return new TextEncoder().encode(JSON.stringify(fixture(extra)));
}

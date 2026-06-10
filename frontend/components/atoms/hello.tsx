interface HelloProperties {
  name: string;
}

export function Hello({ name }: HelloProperties) {
  return <p>Hello, {name}!</p>;
}

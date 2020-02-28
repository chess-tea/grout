let reduce = (action: Action.t, state: State.t): State.t => {
  switch (action) {
  | SetFoo(name) => {...state, foo: name}
  | SetBar(name) => {...state, bar: name}
  };
};

include Store.Make({
  type state = State.t;
  type action = Action.t;
  let initialState = State.default;
  let reduce = Reducer.reduce;
  let equals = (==);
});

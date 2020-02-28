module Log = (val Timber.Log.withNamespace("Store"));

exception OngoingUpdate;

module IntMap =
  Map.Make({
    type t = int;
    let compare = compare;
  });

module type Config = {
  type state;
  type action;
  let initialState: unit => state;
  let reduce: (action, state) => state;
  let equals: (state, state) => bool;
};

module Make = (Config: Config) => {
  module Cache = {
    type handler = {
      fn: unit => unit,
      name: string,
    };

    let _current = ref(Config.initialState());
    let _count = ref(1);
    let _handlers = ref(IntMap.empty);
    let _ongoingUpdate = ref(false);
    let register =
        (~name="<Unspecified>", onChange: unit => unit): (unit => unit) => {
      let myCount = _count^;
      incr(_count);
      _handlers := IntMap.add(myCount, {fn: onChange, name}, _handlers^);
      let unregister = () => {
        if (IntMap.mem(myCount, _handlers^)) {
          // Log.debug("Unregister in cache triggered");
          _handlers := IntMap.remove(myCount, _handlers^);
        };
        ();
      };
      unregister;
    };
    let set = s =>
      if (_ongoingUpdate^) {
        // Log.error("Cannot update store in the middle of an ongoing update.");
        raise(
          OngoingUpdate,
        );
      } else {
        _current := s;
        _ongoingUpdate := true;
        IntMap.iter(
          (_k, v) =>
            try(v.fn()) {
            | e =>
              _ongoingUpdate := false;
              // Log.error("Error when handling state change for: " ++ v.name);
              raise(e);
            },
          _handlers^,
        );
        _ongoingUpdate := false;
      };
    let get = () => _current^;
    let dispatch = action => {
      let currentState = get();
      let nextState = Config.reduce(action, currentState);
      if (!Config.equals(nextState, currentState)) {
        set(nextState);
      };
    };
  };

  let useState = () => {
    // Log.debug("Use state");
    let state = Cache.get();
    let%hook (state, updateState) = Revery.UI.Hooks.state(state);
    let onChange = () => {
      // Log.debug("On Change in hook triggered");
      updateState(_ =>
        Cache.get()
      );
    };

    let%hook () =
      Revery.UI.Hooks.effect(
        Always,
        () => {
          // Log.debug("Register in useState triggered");
          let unregister = Cache.register(onChange);
          Some(unregister);
        },
      );

    (state, Cache.dispatch);
  };
};

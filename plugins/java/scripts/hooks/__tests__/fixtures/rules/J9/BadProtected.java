package demo;

abstract class BadProtected {

    protected String hook() {
        return "";
    }

    public final String name() { // expect: J9
        return hook();
    }

}

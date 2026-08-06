export namespace main {
	
	export class BrewPackage {
	    name: string;
	    version: string;
	    latest_version?: string;
	    description: string;
	    type: string;
	    outdated: boolean;
	    installed: boolean;
	    pinned: boolean;
	    depends_on?: string[];
	    install_time?: string;
	
	    static createFrom(source: any = {}) {
	        return new BrewPackage(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.version = source["version"];
	        this.latest_version = source["latest_version"];
	        this.description = source["description"];
	        this.type = source["type"];
	        this.outdated = source["outdated"];
	        this.installed = source["installed"];
	        this.pinned = source["pinned"];
	        this.depends_on = source["depends_on"];
	        this.install_time = source["install_time"];
	    }
	}
	export class BrewSearchResult {
	    name: string;
	    version: string;
	    description: string;
	    type: string;
	    installed: boolean;
	    score?: number;
	
	    static createFrom(source: any = {}) {
	        return new BrewSearchResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.version = source["version"];
	        this.description = source["description"];
	        this.type = source["type"];
	        this.installed = source["installed"];
	        this.score = source["score"];
	    }
	}
	export class BrewService {
	    name: string;
	    status: string;
	    user?: string;
	    file?: string;
	    exit_code?: string;
	    pid?: string;
	
	    static createFrom(source: any = {}) {
	        return new BrewService(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.status = source["status"];
	        this.user = source["user"];
	        this.file = source["file"];
	        this.exit_code = source["exit_code"];
	        this.pid = source["pid"];
	    }
	}
	export class ImportFailure {
	    name: string;
	    error: string;
	
	    static createFrom(source: any = {}) {
	        return new ImportFailure(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.error = source["error"];
	    }
	}
	export class ImportResult {
	    path: string;
	    cancelled: boolean;
	    total: number;
	    installed: string[];
	    failed: ImportFailure[];
	
	    static createFrom(source: any = {}) {
	        return new ImportResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.path = source["path"];
	        this.cancelled = source["cancelled"];
	        this.total = source["total"];
	        this.installed = source["installed"];
	        this.failed = this.convertValues(source["failed"], ImportFailure);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class SearchResponse {
	    results: BrewSearchResult[];
	    warnings: string[];
	
	    static createFrom(source: any = {}) {
	        return new SearchResponse(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.results = this.convertValues(source["results"], BrewSearchResult);
	        this.warnings = source["warnings"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class TrustInfo {
	    supported: boolean;
	    taps: string[];
	
	    static createFrom(source: any = {}) {
	        return new TrustInfo(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.supported = source["supported"];
	        this.taps = source["taps"];
	    }
	}

}


use std::{collections::BTreeMap, io, path::Path};

use serde::Serialize;
use syn::{
    ExprCall, ExprMethodCall, Pat,
    visit::{self, Visit},
};

#[derive(Serialize)]
pub struct Group {
    pub module: String,
    pub name: String,
    pub restricted: bool,
    pub handlers: Vec<String>,
}

#[derive(Default)]
struct Calls {
    module: Option<String>,
    restricted: bool,
}

impl<'ast> Visit<'ast> for Calls {
    fn visit_expr_call(&mut self, call: &'ast ExprCall) {
        if let syn::Expr::Path(path) = call.func.as_ref() {
            let mut names = path.path.segments.iter().rev();
            if names.next().is_some_and(|name| name.ident == "process") {
                if let Some(module) = names.next() {
                    self.module = Some(module.ident.to_string());
                }
            }
        }
        visit::visit_expr_call(self, call);
    }

    fn visit_expr_method_call(&mut self, call: &'ast ExprMethodCall) {
        self.restricted |= call.method == "bail_restricted";
        visit::visit_expr_method_call(self, call);
    }
}

fn variant(pat: &Pat) -> Option<String> {
    match pat {
        Pat::TupleStruct(pat) => Some(pat.path.segments.last()?.ident.to_string()),
        Pat::Or(pat) if pat.cases.len() == 1 => variant(pat.cases.first()?),
        _ => None,
    }
}

#[derive(Default)]
struct Groups(BTreeMap<String, Group>);

impl<'ast> Visit<'ast> for Groups {
    fn visit_arm(&mut self, arm: &'ast syn::Arm) {
        if let Some(name) = variant(&arm.pat) {
            let mut calls = Calls::default();
            calls.visit_expr(&arm.body);
            if let Some(module) = calls.module {
                self.0.insert(
                    module.clone(),
                    Group {
                        module,
                        name: name.to_lowercase(),
                        restricted: calls.restricted,
                        handlers: Vec::new(),
                    },
                );
            }
        }
        visit::visit_arm(self, arm);
    }
}

#[derive(Default)]
struct Handlers(Vec<String>);

impl<'ast> Visit<'ast> for Handlers {
    fn visit_item_fn(&mut self, function: &'ast syn::ItemFn) {
        let mut calls = Calls::default();
        calls.visit_block(&function.block);
        if function.sig.asyncness.is_some() && calls.restricted {
            self.0.push(function.sig.ident.to_string());
        }
        visit::visit_item_fn(self, function);
    }

    fn visit_impl_item_fn(&mut self, function: &'ast syn::ImplItemFn) {
        let mut calls = Calls::default();
        calls.visit_block(&function.block);
        if function.sig.asyncness.is_some() && calls.restricted {
            self.0.push(function.sig.ident.to_string());
        }
        visit::visit_impl_item_fn(self, function);
    }
}

pub fn read(root: &Path) -> io::Result<Vec<Group>> {
    let parse = |path: &Path| -> io::Result<syn::File> {
        syn::parse_file(&std::fs::read_to_string(path)?)
            .map_err(|error| io::Error::other(format!("{}: {error}", path.display())))
    };
    let mut groups = Groups::default();
    groups.visit_file(&parse(&root.join("src/admin/admin.rs"))?);
    if groups.0.is_empty() {
        return Err(io::Error::other(
            "found no command groups in src/admin/admin.rs",
        ));
    }
    for group in groups.0.values_mut().filter(|group| !group.restricted) {
        let mut handlers = Handlers::default();
        for entry in std::fs::read_dir(root.join("src/admin").join(&group.module))? {
            let path = entry?.path();
            if path.extension().is_some_and(|extension| extension == "rs") {
                handlers.visit_file(&parse(&path)?);
            }
        }
        handlers.0.sort();
        handlers.0.dedup();
        group.handlers = handlers.0;
    }
    Ok(groups.0.into_values().collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn routes_and_restrictions_ignore_formatting_and_comments() {
        let source = syn::parse_file(
            r#"
            async fn process(command: Command) {
                match command {
                    | Users(command) => {
                        context.bail_restricted(
                        )?;
                        user::process(command, context).await
                    },
                    Media(command) => {
                        media::process(command, context).await
                    }
                }
            }
        "#,
        )
        .unwrap();
        let mut groups = Groups::default();
        groups.visit_file(&source);
        assert!(groups.0["user"].restricted);
        assert_eq!(groups.0["user"].name, "users");
        assert!(!groups.0["media"].restricted);
    }

    #[test]
    fn identifies_methods_and_free_functions_with_multiline_calls() {
        let source = syn::parse_file(
            r#"
            async fn public() { let text = "self.bail_restricted()"; }
            async fn restricted() { self.bail_restricted(
            )?; }
            impl Context {
                async fn method(&self) { self.bail_restricted()?; }
            }
        "#,
        )
        .unwrap();
        let mut handlers = Handlers::default();
        handlers.visit_file(&source);
        assert_eq!(handlers.0, ["restricted", "method"]);
    }
}
